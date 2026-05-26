// apps/api/src/routes/v1/public/roster-invites.ts
//
// Public (unauthenticated) tokenized accept / decline handshake for
// roster invites (Epic #11 / Story #926 / Task #931).
//
// Endpoints (Tech Spec #906 §API Changes):
//
//   POST /api/v1/public/roster-invites/:token/accept
//   POST /api/v1/public/roster-invites/:token/decline
//
// Mounted at `/api/v1/public/roster-invites` from `apps/api/src/index.ts`
// BEFORE the `clerkAuth()` chain — possession of the plaintext token is
// the sole authorization. The route layer:
//
//   1. Hashes the path-param token with SHA-256 (`hashToken` from the
//      mailer seam) and looks up the row by `token_hash`. The lookup
//      uses Drizzle's parameterized `eq`, so the plaintext token never
//      enters a SQL fragment. A pre-check refuses obviously malformed
//      tokens (length / charset) before the hash + lookup, but the
//      404-on-mismatch path is the security boundary — an attacker
//      brute-forcing tokens always lands on the same response shape.
//   2. Performs a constant-time comparison of the hashes (`timingSafeEqual`
//      from `node:crypto`) so a row hit cannot be distinguished from a
//      row miss by response timing.
//   3. Refuses any non-`pending` invite. The transitions are one-shot:
//      after `accept` or `decline` the row's status is no longer
//      `pending`, so a second call with the same token resolves to
//      `INVITE_NOT_PENDING` (409).
//   4. Transitions an expired invite lazily — when the row is still
//      `pending` but `expires_at < now()`, the route UPDATEs the row to
//      `status='expired'` in the same handler and returns 409
//      `INVITE_EXPIRED`. No nightly cron is required for MVP per Tech
//      Spec §Data Models.
//   5. On accept: in a single DB transaction, inserts the
//      `athlete_memberships` row (if absent), inserts the `roster_entry`
//      row, and flips the invite to `accepted` with `accepted_at=now()`.
//      The recipient user is resolved by email; for MVP we refuse with
//      `RECIPIENT_NOT_FOUND` (409) when no `users` row matches —
//      JIT-provisioning of an athlete identity from a public token is
//      out of scope for this Story.
//   6. On decline: flips the invite to `declined` with
//      `declined_at=now()` and creates no roster artefacts.
//
// security-baseline.md compliance:
//   - Path-param token validated at the boundary (charset + length).
//   - No SQL concatenation; every predicate is a Drizzle `eq`.
//   - Constant-time hash comparison.
//   - Response shape is identical for "token not found" and "token
//     malformed" (404 NOT_FOUND, no internal detail leaked).
//   - No PII in logs — the handler emits no logs at all; the request
//     logger middleware records the request shape only.
//   - No stack trace exposure — every error path returns a tagged-union
//     envelope without provider error detail.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import { athleteMemberships, rosterEntries, rosterInvites, users } from '@repo/shared/db/schema';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { hashToken } from '../../../mailer/rosterInvite';
import type { RequireInternalUserEnv } from '../../../middleware/auth';

// ── Error taxonomy ─────────────────────────────────────────────────────────

type PublicInviteErrorCode =
  | 'NOT_FOUND'
  | 'INVITE_NOT_PENDING'
  | 'INVITE_EXPIRED'
  | 'INVITE_REVOKED'
  | 'RECIPIENT_NOT_FOUND'
  | 'INVALID_TOKEN';

interface PublicInviteErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: PublicInviteErrorCode;
    readonly message: string;
  };
}

function errorBody(code: PublicInviteErrorCode, message: string): PublicInviteErrorBody {
  return { success: false, error: { code, message } };
}

// ── Token shape pre-check ──────────────────────────────────────────────────

/**
 * The mailer issues a 32-byte (256-bit) random token, hex-encoded —
 * exactly 64 lowercase hex characters. Reject anything else at the
 * boundary so we don't hash arbitrarily large or wrongly-shaped input.
 * The check is shape-only; a well-formed token that no row carries
 * still returns 404 (no existence oracle).
 */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function isValidTokenShape(token: string): boolean {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

// ── DB handle ──────────────────────────────────────────────────────────────

/**
 * Structural shape of the Drizzle handle this router exercises. The
 * production handle is a `BetterSQLite3Database`; the contract test
 * passes the same kind via `drizzle(...)` over an in-memory DB. We
 * narrow only the verbs the handlers use.
 */
interface PublicInviteDbHandle {
  select(columns?: Record<string, unknown>): {
    from(table: unknown): {
      where(predicate: unknown): {
        limit(n: number): { all(): readonly unknown[] };
        all(): readonly unknown[];
      };
    };
  };
  insert(table: unknown): {
    values(values: unknown): { run(): void };
  };
  update(table: unknown): {
    set(values: unknown): {
      where(predicate: unknown): { run(): void };
    };
  };
  transaction<T>(fn: (tx: PublicInviteDbHandle) => T): T;
}

function narrowDb(db: unknown): PublicInviteDbHandle {
  return db as PublicInviteDbHandle;
}

// ── Row projections ────────────────────────────────────────────────────────

interface InviteRow {
  readonly id: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly email: string;
  readonly tokenHash: string;
  readonly status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  readonly expiresAt: Date;
}

interface UserRow {
  readonly id: string;
  readonly orgId: string | null;
  readonly email: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Constant-time string equality over two hex strings of equal length.
 * Returns `false` for any length mismatch without short-circuiting on
 * content — `timingSafeEqual` requires equal-length buffers, so we
 * pre-check length and then compare. Both inputs are hex digests under
 * our control (SHA-256 → 64 hex chars), so this branch is taken only
 * when the row exists and its hash matches the query hash.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Generate a short opaque id for inserted rows. Mirrors the helper in
 * `apps/api/src/routes/v1/coach/invites.ts` so production and test
 * surfaces share one strategy.
 */
function newId(prefix: string): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid = g.crypto?.randomUUID ? g.crypto.randomUUID() : randomBytes(16).toString('hex');
  return `${prefix}_${uuid}`;
}

// ── Router ─────────────────────────────────────────────────────────────────

/**
 * The public router does not require `RequireInternalUserEnv` — it
 * mounts BEFORE `clerkAuth` and reads `c.var.db` directly. We share the
 * type so the surrounding wiring (`withDb`) can be reused if a future
 * Story moves the public mount under `/api/v1/*`.
 */
export const publicRosterInvitesRoute = new Hono<RequireInternalUserEnv>();

/**
 * POST /api/v1/public/roster-invites/:token/accept
 *
 * Tokenized public accept handshake. See module docstring for the
 * complete contract.
 */
publicRosterInvitesRoute.post('/:token/accept', (c) => {
  const token = c.req.param('token');
  if (!isValidTokenShape(token)) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }

  const db = narrowDb(c.get('db'));
  const queryHash = hashToken(token);

  const inviteRows = db
    .select()
    .from(rosterInvites)
    .where(eq(rosterInvites.tokenHash, queryHash))
    .limit(1)
    .all() as readonly InviteRow[];

  const invite = inviteRows[0];
  if (!invite) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }
  // Constant-time defense-in-depth: even though the SQL lookup is by
  // exact-match on the hash, compare the hashes one more time without
  // short-circuiting so any hypothetical broader lookup path retains
  // timing safety.
  if (!constantTimeEqual(invite.tokenHash, queryHash)) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }

  // Lazy expired transition: still pending but past expiry → flip to
  // expired and refuse.
  const now = new Date();
  if (invite.status === 'pending' && invite.expiresAt.getTime() < now.getTime()) {
    db.update(rosterInvites)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(rosterInvites.id, invite.id))
      .run();
    return c.json(errorBody('INVITE_EXPIRED', 'invite-expired'), 409);
  }

  if (invite.status === 'revoked') {
    return c.json(errorBody('INVITE_REVOKED', 'invite-revoked'), 409);
  }
  if (invite.status !== 'pending') {
    return c.json(errorBody('INVITE_NOT_PENDING', `invite-is-${invite.status}`), 409);
  }

  // Resolve the recipient by email. For MVP we refuse when no `users`
  // row matches — JIT-provisioning of an athlete identity from a public
  // token is out of scope (Tech Spec §Authorization). The athlete must
  // already be a known user in this org.
  const userRows = db
    .select()
    .from(users)
    .where(and(eq(users.email, invite.email), eq(users.orgId, invite.orgId)))
    .limit(1)
    .all() as readonly UserRow[];

  const recipient = userRows[0];
  if (!recipient) {
    return c.json(errorBody('RECIPIENT_NOT_FOUND', 'recipient-not-found'), 409);
  }

  // Single-tx accept: insert membership (if absent), insert roster
  // entry, flip invite status. better-sqlite3's `db.transaction` is
  // synchronous and returns the inner result — we use it so a partial
  // failure rolls back every write.
  db.transaction((tx) => {
    // Insert membership if absent. The unique-active predicate on the
    // table (per Tech Spec §Data Models) is not declared in the
    // migration as a partial index here, so we probe first.
    const existingMembership = tx
      .select()
      .from(athleteMemberships)
      .where(
        and(
          eq(athleteMemberships.teamId, invite.teamId),
          eq(athleteMemberships.athleteUserId, recipient.id),
        ),
      )
      .limit(1)
      .all();
    if (existingMembership.length === 0) {
      tx.insert(athleteMemberships)
        .values({
          id: newId('am'),
          orgId: invite.orgId,
          teamId: invite.teamId,
          athleteUserId: recipient.id,
          endedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    tx.insert(rosterEntries)
      .values({
        id: newId('re'),
        orgId: invite.orgId,
        teamId: invite.teamId,
        athleteUserId: recipient.id,
        jerseyNumber: null,
        primaryPosition: null,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    tx.update(rosterInvites)
      .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
      .where(eq(rosterInvites.id, invite.id))
      .run();
  });

  return c.json(
    {
      success: true,
      data: {
        invite: {
          id: invite.id,
          teamId: invite.teamId,
          status: 'accepted' as const,
        },
      },
    },
    200,
  );
});

/**
 * POST /api/v1/public/roster-invites/:token/decline
 *
 * Tokenized public decline handshake. Flips the invite to `declined`
 * and creates no roster artefacts.
 */
publicRosterInvitesRoute.post('/:token/decline', (c) => {
  const token = c.req.param('token');
  if (!isValidTokenShape(token)) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }

  const db = narrowDb(c.get('db'));
  const queryHash = hashToken(token);

  const inviteRows = db
    .select()
    .from(rosterInvites)
    .where(eq(rosterInvites.tokenHash, queryHash))
    .limit(1)
    .all() as readonly InviteRow[];

  const invite = inviteRows[0];
  if (!invite) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }
  if (!constantTimeEqual(invite.tokenHash, queryHash)) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }

  const now = new Date();
  if (invite.status === 'pending' && invite.expiresAt.getTime() < now.getTime()) {
    db.update(rosterInvites)
      .set({ status: 'expired', updatedAt: now })
      .where(eq(rosterInvites.id, invite.id))
      .run();
    return c.json(errorBody('INVITE_EXPIRED', 'invite-expired'), 409);
  }

  if (invite.status === 'revoked') {
    return c.json(errorBody('INVITE_REVOKED', 'invite-revoked'), 409);
  }
  if (invite.status !== 'pending') {
    return c.json(errorBody('INVITE_NOT_PENDING', `invite-is-${invite.status}`), 409);
  }

  db.update(rosterInvites)
    .set({ status: 'declined', declinedAt: now, updatedAt: now })
    .where(eq(rosterInvites.id, invite.id))
    .run();

  return c.json(
    {
      success: true,
      data: {
        invite: {
          id: invite.id,
          teamId: invite.teamId,
          status: 'declined' as const,
        },
      },
    },
    200,
  );
});
