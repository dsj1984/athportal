/**
 * @repo/shared/db/queries/parentAthleteLinks — sanctioned writer for the
 * parent-athlete link established via invite acceptance.
 *
 * Introduced by Epic #8 / Story #555 / Task #569. Tech Spec #490.
 *
 * Invite-token contract (MVP)
 * ---------------------------
 * The invite token format is three URL-safe segments separated by a
 * single ASCII period:
 *
 *     <urlsafe-base64(targetAthleteEmail)>.<parentUserId>.<nonce>
 *
 * Semantics — the *inviter* is a parent who already has a user row; the
 * *invitee* is an athlete who is signing up. The first segment is the
 * base64url-encoded email of the athlete the parent sent the invite to;
 * the second segment is the inviter's `users.id`; the third segment is
 * a sender-generated nonce that gives the token cryptographic
 * unpredictability. This compact format lets the writer verify the
 * target-email-equals-actor-email invariant **without** a separate
 * `invites` table — every fact the handler needs is carried inside the
 * token itself.
 *
 * The full raw token is then SHA-256-hashed and only the hex digest is
 * persisted in `parent_athlete_links.invite_token_hash`. The raw token
 * never lands in the database (security baseline § Output & Rendering).
 *
 * Return values
 * -------------
 *   - `'ok'`        when the target email matches `athleteEmail` AND the
 *                   parent user exists. The row is written. Throws on
 *                   unique-constraint violation — that is the unique-
 *                   index defence-in-depth, not a recoverable condition.
 *
 *   - `'mismatch'`  when the token is malformed, the target email does
 *                   not equal `athleteEmail`, or the encoded parent
 *                   `users.id` does not resolve. NO row is written.
 *                   Callers map this to the API's `INVITE_EMAIL_MISMATCH`
 *                   error envelope.
 *
 * The function deliberately collapses every rejection class into the
 * single `'mismatch'` outcome so a probing client cannot learn which
 * specific check tripped — that is the same uniform-rejection principle
 * the auth layer uses for failed sign-ins.
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { parentAthleteLinks } from '../schema/parentAthleteLinks';
import { users } from '../schema/users';

const ESTABLISHED_VIA_INVITE = 'invite_acceptance' as const;

export interface EstablishLinkInput {
  readonly inviteToken: string;
  readonly athleteUserId: string;
  readonly athleteEmail: string;
}

export type EstablishLinkResult = 'ok' | 'mismatch';

interface ParentLookupRow {
  readonly id: string;
}

interface ParentLookupChain {
  select: (projection: { id: typeof users.id }) => {
    from: (table: typeof users) => {
      where: (predicate: unknown) => {
        limit: (n: number) => { all: () => Array<ParentLookupRow> };
      };
    };
  };
}

interface InsertChain {
  insert: (table: typeof parentAthleteLinks) => {
    values: (row: typeof parentAthleteLinks.$inferInsert) => {
      run: () => unknown;
    };
  };
}

interface DecodedInvite {
  readonly targetEmail: string;
  readonly parentUserId: string;
}

/**
 * Decode the three-segment invite token. Returns `null` for any
 * malformed input. Callers MUST treat `null` as a `'mismatch'` outcome.
 */
function decodeInviteToken(token: string): DecodedInvite | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedEmail, parentUserId, nonce] = parts;
  if (!encodedEmail || !parentUserId || !nonce) return null;
  try {
    const targetEmail = Buffer.from(encodedEmail, 'base64url').toString('utf8');
    if (targetEmail.length === 0 || !targetEmail.includes('@')) return null;
    return { targetEmail, parentUserId };
  } catch {
    return null;
  }
}

function caseInsensitiveEmailEquals(a: string, b: string): boolean {
  // Emails are case-insensitive on every mainstream mail provider; match
  // how every other identity provider on the planet handles this.
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * Persist a parent-athlete link inside the caller-supplied transaction
 * **only when** the invite token's target email equals the athlete's
 * email AND the encoded parent user exists.
 *
 * NOTE: per Tech Spec #490 the onboarding handler validates the actor's
 * Clerk-verified email upstream; this writer trusts the caller's
 * `athleteEmail` argument as the post-Clerk-validation truth. Do not
 * feed it unverified client input.
 */
export function establishLinkFromInvite(
  tx: unknown,
  { inviteToken, athleteUserId, athleteEmail }: EstablishLinkInput,
): EstablishLinkResult {
  const decoded = decodeInviteToken(inviteToken);
  if (decoded === null) return 'mismatch';
  if (!caseInsensitiveEmailEquals(decoded.targetEmail, athleteEmail)) return 'mismatch';

  const handle = tx as ParentLookupChain & InsertChain;
  const parentRows = handle
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, decoded.parentUserId))
    .limit(1)
    .all();
  const parent = parentRows[0];
  if (!parent) return 'mismatch';

  const inviteTokenHash = sha256Hex(inviteToken);
  handle
    .insert(parentAthleteLinks)
    .values({
      id: `${parent.id}:${athleteUserId}`,
      parentUserId: parent.id,
      athleteUserId,
      establishedVia: ESTABLISHED_VIA_INVITE,
      inviteTokenHash,
    })
    .run();
  return 'ok';
}
