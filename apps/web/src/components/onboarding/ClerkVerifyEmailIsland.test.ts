// apps/web/src/components/onboarding/ClerkVerifyEmailIsland.test.ts
//
// Unit tests for the ClerkVerifyEmailIsland's pure-TS view-shape
// builder. The `.astro` sibling renders the surface and the inline
// <script> binds against the real Clerk SDK; the builder is the
// testable surface (web Vitest project runs in node env without a
// JSX/Astro renderer).
//
// Story #574 / Task #582.
import { describe, expect, it } from 'vitest';
import { CLERK_VERIFY_EMAIL_TEST_IDS, buildClerkVerifyEmailView } from './ClerkVerifyEmailIsland';

describe('buildClerkVerifyEmailView', () => {
  it("renders the 'verify your email' copy and exposes the resend label when unverified", () => {
    const view = buildClerkVerifyEmailView({ isVerified: false });
    expect(view.isVerified).toBe(false);
    expect(view.statusLabel.toLowerCase()).toContain('verify your email');
    expect(view.resendLabel.toLowerCase()).toContain('resend');
  });

  it('renders a confirmation when the primary email is verified', () => {
    const view = buildClerkVerifyEmailView({ isVerified: true });
    expect(view.isVerified).toBe(true);
    expect(view.statusLabel.toLowerCase()).toContain('verified');
  });

  it('exposes the canonical onboarding-email-status and onboarding-email-resend testIds', () => {
    const view = buildClerkVerifyEmailView({ isVerified: false });
    expect(view.testIds.status).toBe('onboarding-email-status');
    expect(view.testIds.resend).toBe('onboarding-email-resend');
    expect(view.testIds).toBe(CLERK_VERIFY_EMAIL_TEST_IDS);
  });

  it('keeps the testIds map identical across the verified and unverified branches', () => {
    const unverified = buildClerkVerifyEmailView({ isVerified: false });
    const verified = buildClerkVerifyEmailView({ isVerified: true });
    expect(unverified.testIds).toEqual(verified.testIds);
  });

  it('is a pure function — repeated calls with the same input return the same view shape', () => {
    const a = buildClerkVerifyEmailView({ isVerified: false });
    const b = buildClerkVerifyEmailView({ isVerified: false });
    expect(a).toEqual(b);
  });
});
