// apps/web/src/components/onboarding/AgeAttestation.ts
//
// Pure-TS view-shape + state-evaluator for the AgeAttestation island.
// The single checkbox surfaces COPPA's ≥13 attestation; the API edge
// re-validates via `OnboardInputSchema.ageAttestation.isAtLeast13:
// z.literal(true)`, so submitting `false` returns a 400.
//
// Story #574 / Task #583. Tech Spec #490.

/** Canonical data-testid for the age-attestation island. */
export const AGE_ATTESTATION_TEST_IDS = {
  root: 'onboarding-age-island',
  checkbox: 'onboarding-age-attestation',
} as const;

/** Render-time view shape consumed by the `.astro` sibling. */
export interface AgeAttestationView {
  readonly label: string;
  readonly testIds: typeof AGE_ATTESTATION_TEST_IDS;
}

/**
 * Build the static view. The copy is intentionally identical to the
 * Tech Spec §Frontend reference — changing the wording requires a
 * Spec update + retrospective on every existing acceptance row.
 */
export function buildAgeAttestationView(): AgeAttestationView {
  return {
    label: 'I confirm I am 13 years of age or older.',
    testIds: AGE_ATTESTATION_TEST_IDS,
  };
}

/** Single-flag complete predicate. The form's submit-enabled invariant ANDs this. */
export function ageAttestationComplete(state: { readonly isAtLeast13: boolean }): boolean {
  return state.isAtLeast13 === true;
}
