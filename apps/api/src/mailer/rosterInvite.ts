// apps/api/src/mailer/rosterInvite.ts
//
// Thin transactional-mail seam for the coach roster-invite send path
// (Epic #11 / Story #920 / Task #927). Composes the invite email body
// from a `roster_invite` row + the plaintext token, and dispatches via
// an injected transport so production wiring (a future Postmark /
// Resend / Cloudflare Email Workers adapter) can land without
// re-touching every call site.
//
// Contract pinned by Tech Spec #906 §Security & Privacy and the
// Task #927 ACs:
//
//   1. `hashToken(plaintext)` returns the **hex-encoded SHA-256** of
//      the plaintext token. The unique index on
//      `roster_invite.token_hash` keys off this value; the plaintext
//      is NEVER persisted at rest.
//   2. `sendRosterInviteEmail(invite, plaintextToken, opts)` composes
//      exactly one accept URL and one decline URL — both keyed by the
//      plaintext token — and hands them, along with the rest of the
//      message envelope, to the injected `transport.send`. The token
//      MUST NOT appear in any structured log emitted by this module
//      and MUST NOT be returned to the caller.
//   3. The transport surface is async and may be mocked in tests; the
//      production transport will be wired by a separate Story once
//      the operator selects a provider. The Tech Spec deliberately
//      defers that choice — this seam stays provider-neutral.
//
// security-baseline.md §Data Leakage & Logging: no PII or token
// material is logged. The module exposes a structured event shape
// (`RosterInviteEmailLogEvent`) that the caller may emit; the event
// carries only the invite id, team id, and a redacted email domain
// — never the plaintext token, never the full email local-part.

import { createHash } from 'node:crypto';

/**
 * Hex-encoded SHA-256 of the plaintext token. Used both at insert
 * time (the API route stores this in `roster_invite.token_hash`) and
 * at lookup time on the public accept route (constant-time compare
 * against the stored hash — done by the route layer, not this seam).
 *
 * Pure: identical input always yields identical output. No side
 * effects. Safe to call from unit tests without any harness.
 */
export function hashToken(plaintext: string): string {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('hashToken: plaintext must be a non-empty string');
  }
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/**
 * Shape of one outstanding `roster_invite` row as the mailer needs to
 * read it. Declared structurally so callers can pass either the full
 * `RosterInvite` row from `@repo/shared/db/schema/rosterInvites` or
 * any object that satisfies this contract — keeps the mailer free of
 * the Drizzle type surface and trivially testable.
 */
export interface RosterInviteForMail {
  readonly id: string;
  readonly teamId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly expiresAt: Date;
}

/**
 * Composed message envelope handed to the transport. Provider-
 * neutral by design — Postmark / Resend / Cloudflare Email Workers
 * adapters will pick the fields they need without re-shaping the
 * mailer surface.
 */
export interface RosterInviteEmailMessage {
  readonly to: string;
  readonly from: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /**
   * Provider-agnostic message metadata. The keys are stable across
   * providers so future log routing (Cloudflare Logs, OTel, …) can
   * pivot on them without re-mapping.
   */
  readonly meta: {
    readonly inviteId: string;
    readonly teamId: string;
    readonly kind: 'roster-invite';
  };
}

/**
 * Transport seam. The production transport will be wired in a
 * follow-on Story once the provider is chosen — Tech Spec #906
 * deliberately leaves the choice open. Tests inject a hand-rolled
 * stub that records the message envelope.
 *
 * The transport is async and returns void; a thrown error propagates
 * to the route layer, which surfaces a 502/500 to the coach.
 */
export interface RosterInviteMailTransport {
  send(message: RosterInviteEmailMessage): Promise<void>;
}

/**
 * Options bag for `sendRosterInviteEmail`. Pinned by Task #927: the
 * `baseUrl` is read from the request env at the call site so the
 * accept/decline links resolve against the actor's deployment (prod,
 * preview, local).
 */
export interface SendRosterInviteOptions {
  readonly transport: RosterInviteMailTransport;
  /**
   * Origin (scheme + host) for the accept/decline links — e.g.
   * `https://app.athportal.example`. Trailing slashes are stripped.
   */
  readonly baseUrl: string;
  /**
   * "From" address surfaced on the email envelope. Defaults to
   * `roster-invites@athportal.local` when omitted — production wiring
   * MUST pass a real, deliverable origin.
   */
  readonly fromAddress?: string;
}

/**
 * Build the public accept URL for a plaintext token. The path shape
 * follows Tech Spec #906 §Web routes (`/r/roster-invite/:token/accept`).
 *
 * Centralised so the email body and the public route handler share
 * one definition — a future path change lands once.
 */
export function buildAcceptUrl(baseUrl: string, plaintextToken: string): string {
  return `${stripTrailingSlash(baseUrl)}/r/roster-invite/${encodeURIComponent(plaintextToken)}/accept`;
}

/**
 * Build the public decline URL for a plaintext token. Same shape /
 * conventions as `buildAcceptUrl`.
 */
export function buildDeclineUrl(baseUrl: string, plaintextToken: string): string {
  return `${stripTrailingSlash(baseUrl)}/r/roster-invite/${encodeURIComponent(plaintextToken)}/decline`;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * Compose the human-readable greeting for the invite. Uses the
 * recipient's first name when present; otherwise falls back to a
 * neutral salutation. Never embeds the email local-part in the
 * greeting (would leak more PII than the recipient already sees).
 */
function greeting(invite: RosterInviteForMail): string {
  const first = invite.firstName?.trim();
  if (first && first.length > 0) return `Hi ${first},`;
  return 'Hi there,';
}

/**
 * Compose the plain-text body. Two paragraphs + the two URLs on
 * their own lines so plaintext mail readers can present clickable
 * links even when the HTML part is stripped.
 */
function plainTextBody(
  invite: RosterInviteForMail,
  acceptUrl: string,
  declineUrl: string,
): string {
  return [
    greeting(invite),
    '',
    `You've been invited to join a team on Athlete Portal.`,
    '',
    'Accept the invitation:',
    acceptUrl,
    '',
    'Or decline:',
    declineUrl,
    '',
    'This invitation expires on ' + invite.expiresAt.toISOString().slice(0, 10) + '.',
  ].join('\n');
}

/**
 * Compose the HTML body. Uses textContent-style escaping for every
 * recipient-controlled or token-derived value via `escapeHtml` so a
 * malicious display name or token shape cannot inject markup
 * (security-baseline.md §Output & Rendering).
 *
 * The HTML is intentionally minimal — table-based layouts and inline
 * styles are the responsibility of the production transport's
 * template engine, not this seam.
 */
function htmlBody(
  invite: RosterInviteForMail,
  acceptUrl: string,
  declineUrl: string,
): string {
  return [
    `<p>${escapeHtml(greeting(invite))}</p>`,
    `<p>You've been invited to join a team on Athlete Portal.</p>`,
    `<p><a href="${escapeHtmlAttr(acceptUrl)}">Accept the invitation</a></p>`,
    `<p><a href="${escapeHtmlAttr(declineUrl)}">Decline</a></p>`,
    `<p>This invitation expires on ${escapeHtml(invite.expiresAt.toISOString().slice(0, 10))}.</p>`,
  ].join('\n');
}

/**
 * HTML-escape a text node value. Replaces the five characters that
 * carry markup meaning in element content. Sufficient for the values
 * this module embeds (a first-name string, an ISO date) — anything
 * richer should not be flowing through the mailer.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * HTML-escape an attribute value. Uses the same map as `escapeHtml`
 * — distinct entry point so a future hardening pass (e.g. refusing
 * `javascript:` URLs) attaches here without touching element-content
 * call sites.
 */
function escapeHtmlAttr(value: string): string {
  return escapeHtml(value);
}

/**
 * Compose the invite email and hand it to the injected transport.
 *
 * The plaintext token appears ONLY in the URLs embedded in the
 * message body and in the local closure here — it is never logged,
 * never persisted, never returned to the caller. The function's
 * return value is `void`; any provider failure raises from
 * `transport.send` and the route layer is responsible for surfacing
 * an envelope-shaped error to the coach.
 *
 * @param invite — the persisted `roster_invite` row (or a structural
 *                 subset). The mailer reads `email`, `firstName`,
 *                 `id`, `teamId`, and `expiresAt`.
 * @param plaintextToken — the 32-byte random token, hex-encoded by
 *                         the caller. The token is treated as
 *                         opaque; the mailer only embeds it in the
 *                         URLs and never hashes it itself (the route
 *                         layer calls `hashToken` for persistence).
 * @param opts — transport + base URL + optional from-address.
 */
export async function sendRosterInviteEmail(
  invite: RosterInviteForMail,
  plaintextToken: string,
  opts: SendRosterInviteOptions,
): Promise<void> {
  if (typeof plaintextToken !== 'string' || plaintextToken.length === 0) {
    throw new Error('sendRosterInviteEmail: plaintextToken must be a non-empty string');
  }
  if (!opts || typeof opts.baseUrl !== 'string' || opts.baseUrl.length === 0) {
    throw new Error('sendRosterInviteEmail: opts.baseUrl must be a non-empty string');
  }

  const acceptUrl = buildAcceptUrl(opts.baseUrl, plaintextToken);
  const declineUrl = buildDeclineUrl(opts.baseUrl, plaintextToken);

  const message: RosterInviteEmailMessage = {
    to: invite.email,
    from: opts.fromAddress ?? 'roster-invites@athportal.local',
    subject: 'You have a roster invite',
    text: plainTextBody(invite, acceptUrl, declineUrl),
    html: htmlBody(invite, acceptUrl, declineUrl),
    meta: {
      inviteId: invite.id,
      teamId: invite.teamId,
      kind: 'roster-invite',
    },
  };

  await opts.transport.send(message);
}

/**
 * Structured log event for emission by the caller after a successful
 * dispatch. The shape deliberately OMITS the plaintext token and the
 * email local-part — the route layer is free to emit this for
 * observability (count of invites sent, failure rate by team) without
 * leaking PII per security-baseline.md §Data Leakage & Logging.
 */
export interface RosterInviteEmailLogEvent {
  readonly kind: 'roster-invite-sent';
  readonly inviteId: string;
  readonly teamId: string;
  readonly emailDomain: string;
}

/**
 * Build a safe-to-log event from an invite row. Extracts only the
 * email domain (everything after `@`) so observability dashboards
 * surface per-tenant invite volume without the recipient address.
 *
 * Pure: identical input always yields identical output. No side
 * effects.
 */
export function buildLogEvent(invite: RosterInviteForMail): RosterInviteEmailLogEvent {
  const atIdx = invite.email.lastIndexOf('@');
  const domain = atIdx > 0 ? invite.email.slice(atIdx + 1) : 'unknown';
  return {
    kind: 'roster-invite-sent',
    inviteId: invite.id,
    teamId: invite.teamId,
    emailDomain: domain,
  };
}
