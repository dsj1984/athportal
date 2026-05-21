// apps/web/src/components/onboarding/ClerkVerifyEmailIsland.ts
//
// Pure-TS view-shape builder for the ClerkVerifyEmailIsland. The
// `.astro` sibling renders the surface and the inline <script> hydrates
// against `window.Clerk.user.primaryEmailAddress.verification.status`.
// Keeping the copy/branch decisions in a pure-TS module lets the unit
// tier (Task #582) exercise the verified/unverified rendering branches
// without standing up a renderer.
//
// Story #574 / Task #582. Tech Spec #490.

/**
 * Canonical data-testids exposed by the verify-email island. Locked by
 * Tech Spec #490 §Frontend so acceptance scenarios can target stable
 * selectors across re-renders.
 */
export const CLERK_VERIFY_EMAIL_TEST_IDS = {
  root: 'onboarding-email-island',
  status: 'onboarding-email-status',
  resend: 'onboarding-email-resend',
} as const;

/** Input the builder consumes — strictly Clerk's verification flag. */
export interface ClerkVerifyEmailViewInput {
  /** True iff `Clerk.user.primaryEmailAddress.verification.status === 'verified'`. */
  readonly isVerified: boolean;
}

/**
 * Render-time view shape. The `statusLabel` is the human copy the
 * `.astro` sibling shows next to the verification badge; the
 * `resendLabel` is the resend-button label (which the sibling hides
 * outright when `isVerified` is true).
 */
export interface ClerkVerifyEmailView {
  readonly isVerified: boolean;
  readonly statusLabel: string;
  readonly resendLabel: string;
  readonly testIds: typeof CLERK_VERIFY_EMAIL_TEST_IDS;
}

/**
 * Shape the input into the render-ready view. The two branches:
 *
 *   - `isVerified: true`  → "Email verified" + a resend label that will
 *     never be displayed (the sibling hides the button).
 *   - `isVerified: false` → "Verify your email address" + "Resend
 *     verification email".
 */
export function buildClerkVerifyEmailView(input: ClerkVerifyEmailViewInput): ClerkVerifyEmailView {
  if (input.isVerified) {
    return {
      isVerified: true,
      statusLabel: 'Email verified',
      resendLabel: 'Resend verification email',
      testIds: CLERK_VERIFY_EMAIL_TEST_IDS,
    };
  }
  return {
    isVerified: false,
    statusLabel: 'Verify your email address to continue.',
    resendLabel: 'Resend verification email',
    testIds: CLERK_VERIFY_EMAIL_TEST_IDS,
  };
}
