// apps/web/src/pages/r/roster-invite/[token]/accept-page.ts
//
// Pure, browser-agnostic helpers for the `/r/roster-invite/:token/accept`
// landing page (Story #926). These are extracted from the page's inline
// script so the error-copy and sign-up-link logic can be unit-tested
// without a DOM (Story #1053).
//
// Story #1053 (F32 polish): when the accept handshake returns
// `RECIPIENT_NOT_FOUND`, the recipient is an as-yet-unprovisioned identity
// (per ADR-021 the public accept route never mints a user). Rather than a
// dead-end, surface an actionable "Sign up" link to the Clerk sign-up
// surface, pre-filled with the invite email where the caller can supply it.
//
// Out of scope (tracked by the V1.0 JIT-chaining Story #1056): auto-resuming
// the accept after sign-up. The invite is NOT consumed by a
// `RECIPIENT_NOT_FOUND` refusal — it stays `pending` until expiry — so the
// copy here must avoid implying the invite is lost.

/**
 * The path the Clerk `<SignUp />` surface is mounted at
 * (`apps/web/src/pages/sign-up/`).
 */
export const SIGN_UP_PATH = '/sign-up';

/**
 * Build a `/sign-up` href, pre-filling the email when one is available.
 *
 * Clerk's hosted/direct sign-up surface reads the `email_address` query
 * parameter to prefill the email field (Clerk direct-links contract). When
 * no email is available — the public accept route never echoes the invite
 * email back to the client, so prefill is best-effort — we link to the bare
 * sign-up path. "where supported" in the acceptance criteria maps to "when
 * the caller can supply an email".
 *
 * @param email Optional invite email to prefill. Blank/whitespace-only
 *   values are treated as absent.
 */
export function buildSignUpHref(email?: string | null): string {
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (trimmed.length === 0) {
    return SIGN_UP_PATH;
  }
  const params = new URLSearchParams({ email_address: trimmed });
  return `${SIGN_UP_PATH}?${params.toString()}`;
}

/**
 * Resolution of an accept-handshake error into the user-facing copy and,
 * where applicable, an actionable affordance.
 *
 * `signUpHref` is populated only for the `RECIPIENT_NOT_FOUND` branch — the
 * one error where the recipient can self-serve by creating an identity.
 */
export interface AcceptErrorResolution {
  readonly message: string;
  readonly signUpHref?: string;
}

/**
 * Map an API error code to its resolution. Pure: no DOM, no I/O.
 *
 * @param code The `error.code` from the accept envelope, if any.
 * @param email Optional invite email used to prefill the sign-up link on the
 *   `RECIPIENT_NOT_FOUND` branch.
 */
export function resolveAcceptError(
  code: string | undefined,
  email?: string | null,
): AcceptErrorResolution {
  switch (code) {
    case 'NOT_FOUND':
      return {
        message: 'This invitation link is not valid. Ask your coach to send a new one.',
      };
    case 'INVITE_EXPIRED':
      return {
        message: 'This invitation has expired. Ask your coach to send a new one.',
      };
    case 'INVITE_REVOKED':
      return { message: 'Your coach cancelled this invitation.' };
    case 'INVITE_NOT_PENDING':
      return { message: 'This invitation has already been responded to.' };
    case 'RECIPIENT_NOT_FOUND':
      // The invite is still pending — it is not lost. The recipient just
      // does not have an account yet. Sign up, then re-accept once the coach
      // re-sends or the identity exists (auto-resume is Story #1056).
      return {
        message:
          'You don’t have an account yet, so we couldn’t add you to the roster. ' +
          'Your invitation is still waiting for you — sign up below, then ask ' +
          'your coach to re-send it (or open the link again once your account ' +
          'is ready).',
        signUpHref: buildSignUpHref(email),
      };
    default:
      return {
        message: 'We could not accept this invitation. Please try again later.',
      };
  }
}
