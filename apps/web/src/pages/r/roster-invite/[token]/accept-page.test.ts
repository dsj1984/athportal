// apps/web/src/pages/r/roster-invite/[token]/accept-page.test.ts
//
// Unit coverage for the accept-page error-resolution helpers (Story #1053).
// These are pure functions — no DOM, no network — so they exercise the
// RECIPIENT_NOT_FOUND actionable-sign-up branch and the email prefill in
// isolation. The full client flow is exercised via manual QA; this tier
// pins the copy and the sign-up-href contract.

import { describe, expect, it } from 'vitest';
import { SIGN_UP_PATH, buildSignUpHref, resolveAcceptError } from './accept-page';

describe('buildSignUpHref', () => {
  it('returns the bare sign-up path when no email is supplied', () => {
    expect(buildSignUpHref()).toBe(SIGN_UP_PATH);
    expect(buildSignUpHref(null)).toBe(SIGN_UP_PATH);
    expect(buildSignUpHref('')).toBe(SIGN_UP_PATH);
    expect(buildSignUpHref('   ')).toBe(SIGN_UP_PATH);
  });

  it('prefills the email via the Clerk email_address query param', () => {
    expect(buildSignUpHref('athlete@example.com')).toBe(
      '/sign-up?email_address=athlete%40example.com',
    );
  });

  it('trims surrounding whitespace before encoding', () => {
    expect(buildSignUpHref('  athlete@example.com  ')).toBe(
      '/sign-up?email_address=athlete%40example.com',
    );
  });
});

describe('resolveAcceptError', () => {
  it('renders an actionable sign-up link on RECIPIENT_NOT_FOUND', () => {
    const resolution = resolveAcceptError('RECIPIENT_NOT_FOUND');
    expect(resolution.signUpHref).toBe(SIGN_UP_PATH);
  });

  it('prefills the sign-up link with the invite email where supported', () => {
    const resolution = resolveAcceptError('RECIPIENT_NOT_FOUND', 'athlete@example.com');
    expect(resolution.signUpHref).toBe('/sign-up?email_address=athlete%40example.com');
  });

  it('uses reassuring copy that does not imply the invite is lost', () => {
    const { message } = resolveAcceptError('RECIPIENT_NOT_FOUND');
    // The invite remains pending until expiry — copy must not say it is
    // gone, cancelled, or that the recipient must start over from scratch.
    expect(message).toMatch(/still waiting/i);
    expect(message).not.toMatch(/lost|cancelled|expired|invalid/i);
    // It must reference signing up as the next step.
    expect(message).toMatch(/sign up/i);
  });

  it('does not auto-resume accept — copy only points at sign-up, not re-accept automation', () => {
    const { message } = resolveAcceptError('RECIPIENT_NOT_FOUND');
    // The recipient is told to sign up and have the coach re-send / reopen
    // the link — there is no promise the accept resumes automatically.
    expect(message).toMatch(/re-send|open the link again/i);
  });

  it('does NOT offer a sign-up link for unrelated error codes', () => {
    for (const code of [
      'NOT_FOUND',
      'INVITE_EXPIRED',
      'INVITE_REVOKED',
      'INVITE_NOT_PENDING',
      undefined,
      'SOMETHING_ELSE',
    ]) {
      expect(resolveAcceptError(code).signUpHref).toBeUndefined();
    }
  });

  it('maps each known code to non-empty copy', () => {
    for (const code of [
      'NOT_FOUND',
      'INVITE_EXPIRED',
      'INVITE_REVOKED',
      'INVITE_NOT_PENDING',
      'RECIPIENT_NOT_FOUND',
      undefined,
    ]) {
      expect(resolveAcceptError(code).message.length).toBeGreaterThan(0);
    }
  });
});
