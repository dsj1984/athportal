// apps/web/src/components/onboarding/index.ts
//
// Barrel re-export for the onboarding islands' pure-TS surfaces — the
// view-shape helpers, working-state evaluators, and canonical
// data-testid maps every onboarding component owns. Consumers (the
// page, future dashboard surfaces, acceptance steps) import the
// behavior from this single entry point so a rename / move of any
// helper is local to this barrel.
//
// The `.astro` siblings are NOT re-exported here. Astro files are
// resolved by the Astro loader at SSR-time, not by TypeScript at
// type-check time; pages import the `.astro` components directly via
// relative paths. Re-exporting them from a `.ts` barrel would force
// every consumer to bring the Astro virtual-module resolver in scope.
//
// Story #574 / Task #580. Tech Spec #490.

export {
  ONBOARDING_FORM_TEST_IDS,
  type OnboardingFormState,
  type OnboardingFormEvaluation,
  type OnboardingPayloadResult,
  type ServerErrorEnvelope,
  createInitialOnboardingFormState,
  evaluateOnboardingFormState,
  buildOnboardingPayload,
  tryBuildOnboardingPayload,
  foldServerErrorsIntoFieldMap,
} from './OnboardingForm';

export {
  CLERK_VERIFY_EMAIL_TEST_IDS,
  type ClerkVerifyEmailView,
  type ClerkVerifyEmailViewInput,
  buildClerkVerifyEmailView,
} from './ClerkVerifyEmailIsland';

export {
  LEGAL_ACCEPTANCE_TEST_IDS,
  type LegalAcceptanceProps,
  type LegalAcceptanceState,
  type LegalAcceptanceView,
  buildLegalAcceptanceView,
  legalAcceptanceComplete,
} from './LegalAcceptanceCheckboxes';

export {
  AGE_ATTESTATION_TEST_IDS,
  type AgeAttestationView,
  buildAgeAttestationView,
  ageAttestationComplete,
} from './AgeAttestation';

export {
  PROFILE_PHOTO_TEST_IDS,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_ALLOWED_MIME,
  type ProfilePhotoView,
  type ProfilePhotoAllowedMime,
  buildProfilePhotoView,
  validateProfilePhotoFile,
} from './ProfilePhotoUploader';
