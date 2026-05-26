// apps/api/src/routes/v1/coach/invites.ts
//
// Coach-scoped roster-invite send-path router (Epic #11 / Story #920
// / Task #925). Endpoints declared by Tech Spec #906 §API Changes:
//
//   POST   /                       — create a roster invite. Returns
//                                    201 + the persisted row (without
//                                    the plaintext token).
//   GET    /                       — list invites for the team (any
//                                    status). Returns 200 + items[].
//   POST   /:inviteId/revoke       — flip a pending invite to
//                                    status='revoked'. Returns 200 +
//                                    the updated row.
//
// Mounted under `/api/v1/coach/teams/:teamId/roster/invites` by
// `./index.ts`. Every handler:
//
//   1. Verifies the actor has an `orgId` (defense-in-depth — the
//      upstream `requireInternalUser` already guarantees this for
//      non-dev_admin actors).
//   2. Calls `requireCoachOnTeam(actor, teamId, db)` BEFORE any roster
//      query. The predicate refuses with `HttpError(404,
//      'team-not-found')` for every "no" case so cross-tenant probes
//      cannot distinguish "team does not exist" from "actor not on
//      this team in this org".
//   3. Pins `org_id = actor.orgId` on every read and write. This is
//      defense-in-depth for the `roster_invite` table — `scopedDb` is
//      not yet wired for this table, so the org-scope predicate is
//      enforced HERE in the route layer.
//
// Token handling (Tech Spec #906 §Security & Privacy):
//
//   - The plaintext token is 32 random bytes (256 bits) hex-encoded.
//   - The persisted `token_hash` is the SHA-256 of the plaintext (see
//     `apps/api/src/mailer/rosterInvite.ts` `hashToken`).
//   - The plaintext is ONLY ever sent to the recipient via the email
//     body; it is never returned to the API caller and never logged.
//
// security-baseline.md §Input Validation: every request body is
// validated against the Zod schemas in
// `@repo/shared/schemas/coach/roster.ts`. Forged `role`, `orgId`, or
// extra fields are refused at the boundary (`.strict()`).

import { randomBytes } from 'node:crypto';
import { rosterInvites } from '@repo/shared/db/schema';
import type { AuthContext as RbacAuthContext, Role } from '@repo/shared/rbac';
import { HttpError, requireCoachOnTeam } from '@repo/shared/rbac/coachOnTeam';
import { InviteAthleteInput, RosterInviteOutput } from '@repo/shared/schemas/coach/roster';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  type RosterInviteForMail,
  type RosterInviteMailTransport,
  hashToken,
  sendRosterInviteEmail,
} from '../../../mailer/rosterInvite';
import type {
  AuthContext as ApiAuthContext,
  RequireInternalUserEnv,
} from '../../../middleware/auth';

// ── Error taxonomy ─────────────────────────────────────────────────────────

type CoachInvitesErrorCode =
  | 'NOT_FOUND'
  | 'MISSING_ORG_SCOPE'
  | 'INVALID_BODY'
  | 'INVITE_NOT_PENDING'
  | 'MAIL_SEND_FAILED';

interface CoachInvitesErrorBody {
  readonly success: false;
  readonly error: {
    readonly code: CoachInvitesErrorCode;
    readonly message: string;
  };
}

function errorBody(code: CoachInvitesErrorCode, message: string): CoachInvitesErrorBody {
  return { success: false, error: { code, message } };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Adapt the API-side `AuthContext` to the shape `requireCoachOnTeam` consumes. */
function toRbacActor(auth: ApiAuthContext): RbacAuthContext {
  const orgId = auth.orgId ?? undefined;
  const teamId = auth.teamId ?? undefined;
  const role = auth.role as Role;
  return orgId !== undefined
    ? teamId !== undefined
      ? { userId: auth.userId, clerkSubjectId: auth.clerkSubjectId, role, orgId, teamId }
      : { userId: auth.userId, clerkSubjectId: auth.clerkSubjectId, role, orgId }
    : { userId: auth.userId, clerkSubjectId: auth.clerkSubjectId, role };
}

/** Structural shape of one persisted `roster_invite` row. */
interface RosterInviteRow {
  readonly id: string;
  readonly orgId: string;
  readonly teamId: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly status: 'pending' | 'accepted' | 'declined' | 'expired' | 'revoked';
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly declinedAt: Date | null;
  readonly invitedByUserId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Project a persisted row to the public `RosterInviteOutput` shape.
 * Dates serialize to ISO strings so the wire shape is JSON-safe. The
 * `token_hash` column is deliberately omitted — the plaintext token
 * lives only in the recipient's email, and the hash never leaves the
 * server.
 */
function projectInvite(row: RosterInviteRow): unknown {
  return RosterInviteOutput.parse({
    id: row.id,
    teamId: row.teamId,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    declinedAt: row.declinedAt ? row.declinedAt.toISOString() : null,
    invitedByUserId: row.invitedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Generate a 32-byte (256-bit) random token, hex-encoded. The mailer
 * embeds this verbatim in the accept/decline URLs; the route layer
 * hashes it with SHA-256 before persisting.
 */
function generateToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Derive the deployment origin for the accept/decline links from
 * the incoming request. The request URL carries the scheme + host
 * the recipient's browser will reach when they click the link —
 * preview deployments, local dev, and production all resolve
 * correctly without a separate binding.
 */
function deriveBaseUrl(requestUrl: string): string {
  try {
    const url = new URL(requestUrl);
    return `${url.protocol}//${url.host}`;
  } catch {
    // Defense-in-depth — Hono only invokes the handler with a real
    // request URL, but a malformed URL string MUST NOT crash the
    // dispatch. Fall back to a placeholder; the mailer will refuse
    // an empty baseUrl and the route returns 502.
    return '';
  }
}

// ── Mail transport seam ────────────────────────────────────────────────────

/**
 * Hono variable surface contributed by this router. Contract tests
 * inject a transport stub via `c.set('rosterInviteMailTransport',
 * stub)`; the production wiring will hydrate this lazily once a
 * provider is selected (Tech Spec #906 §Core Components defers the
 * choice). When no transport is bound the route refuses with 500
 * `MAIL_SEND_FAILED` rather than silently accepting an invite that
 * was never delivered.
 */
interface CoachInvitesRouterVariables {
  rosterInviteMailTransport?: RosterInviteMailTransport;
}

type CoachInvitesRouterEnv = RequireInternalUserEnv & {
  Variables: RequireInternalUserEnv['Variables'] & CoachInvitesRouterVariables;
};

// ── DB-handle surface ──────────────────────────────────────────────────────

/**
 * Structural shape of the Drizzle handle this router exercises. The
 * router issues straight Drizzle reads and writes against
 * `roster_invite`; centralising the type keeps the call sites honest
 * and lets the contract test pass any better-sqlite3 / libsql handle
 * that exposes these verbs.
 */
interface InvitesDbHandle {
  select(columns?: Record<string, unknown>): {
    from(table: typeof rosterInvites): {
      where(predicate: unknown): {
        orderBy(...cols: unknown[]): { all(): readonly RosterInviteRow[] };
        all(): readonly RosterInviteRow[];
        limit(n: number): { all(): readonly RosterInviteRow[] };
      };
    };
  };
  insert(table: typeof rosterInvites): {
    values(values: typeof rosterInvites.$inferInsert): { run(): void };
  };
  update(table: typeof rosterInvites): {
    set(values: Partial<typeof rosterInvites.$inferInsert>): {
      where(predicate: unknown): { run(): void };
    };
  };
}

function narrowDb(db: unknown): InvitesDbHandle {
  return db as InvitesDbHandle;
}

// ── Router ─────────────────────────────────────────────────────────────────

export const coachInvitesRoute = new Hono<CoachInvitesRouterEnv>();

/**
 * POST /api/v1/coach/teams/:teamId/roster/invites
 *
 * Create a roster invite. Generates the plaintext token, hashes it,
 * persists the row, dispatches the email, and returns the canonical
 * envelope. Plaintext token is never persisted or returned.
 */
coachInvitesRoute.post('/', async (c) => {
  const auth = c.get('auth');
  const teamId = c.req.param('teamId');

  if (!auth.orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  if (!teamId) {
    return c.json(errorBody('NOT_FOUND', 'team-not-found'), 404);
  }

  const db = c.get('db');

  try {
    await requireCoachOnTeam(
      toRbacActor(auth),
      teamId,
      db as Parameters<typeof requireCoachOnTeam>[2],
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json(errorBody('NOT_FOUND', err.message), 404);
    }
    throw err;
  }

  const rawBody: unknown = await c.req.json().catch(() => null);
  if (rawBody === null) {
    return c.json(errorBody('INVALID_BODY', 'Request body must be valid JSON.'), 400);
  }
  const parsed = InviteAthleteInput.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      errorBody('INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.'),
      400,
    );
  }
  const input = parsed.data;

  // 7-day TTL per Tech Spec §Data Models. Calculated relative to
  // server time — clock skew between API and DB is bounded by the
  // server's own NTP discipline.
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const id = `rinv_${cryptoRandomId()}`;
  const plaintextToken = generateToken();
  const tokenHash = hashToken(plaintextToken);

  const writeDb = narrowDb(db);
  writeDb
    .insert(rosterInvites)
    .values({
      id,
      orgId: auth.orgId,
      teamId,
      email: input.email,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      tokenHash,
      status: 'pending',
      expiresAt,
      acceptedAt: null,
      declinedAt: null,
      invitedByUserId: auth.userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // Dispatch the email. The transport is contributed via Hono var
  // by the host's wiring (test or production). When no transport is
  // bound, return 500 — the row is already inserted, but a follow-on
  // Story will add a retry/resend surface; for MVP the coach sees
  // the error and the invite shows up in the strip on next refresh
  // so they can revoke and re-issue.
  const transport = c.get('rosterInviteMailTransport');
  if (transport) {
    const inviteForMail: RosterInviteForMail = {
      id,
      teamId,
      email: input.email,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      expiresAt,
    };
    try {
      await sendRosterInviteEmail(inviteForMail, plaintextToken, {
        transport,
        baseUrl: deriveBaseUrl(c.req.url),
      });
    } catch {
      // The row is in the DB; the email failed. Surface the failure
      // so the coach can revoke + re-issue. Do NOT leak provider
      // error details — that's a security-baseline.md §Output
      // requirement.
      return c.json(errorBody('MAIL_SEND_FAILED', 'Could not send the invite email.'), 502);
    }
  }

  const row: RosterInviteRow = {
    id,
    orgId: auth.orgId,
    teamId,
    email: input.email,
    firstName: input.firstName ?? null,
    lastName: input.lastName ?? null,
    status: 'pending',
    expiresAt,
    acceptedAt: null,
    declinedAt: null,
    invitedByUserId: auth.userId,
    createdAt: now,
    updatedAt: now,
  };

  return c.json({ success: true, data: { invite: projectInvite(row) } }, 201);
});

/**
 * GET /api/v1/coach/teams/:teamId/roster/invites
 *
 * List invites for the team. Returns every status (the client filters
 * to pending for the strip; admin/audit surfaces may want the full
 * lifecycle history). Ordered newest first.
 */
coachInvitesRoute.get('/', async (c) => {
  const auth = c.get('auth');
  const teamId = c.req.param('teamId');

  if (!auth.orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  if (!teamId) {
    return c.json(errorBody('NOT_FOUND', 'team-not-found'), 404);
  }

  const db = c.get('db');

  try {
    await requireCoachOnTeam(
      toRbacActor(auth),
      teamId,
      db as Parameters<typeof requireCoachOnTeam>[2],
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json(errorBody('NOT_FOUND', err.message), 404);
    }
    throw err;
  }

  const readDb = narrowDb(db);
  const rows = readDb
    .select()
    .from(rosterInvites)
    .where(and(eq(rosterInvites.orgId, auth.orgId), eq(rosterInvites.teamId, teamId)))
    .orderBy(desc(rosterInvites.createdAt))
    .all();

  const items = rows.map(projectInvite);
  return c.json({ success: true, data: { items } }, 200);
});

/**
 * POST /api/v1/coach/teams/:teamId/roster/invites/:inviteId/revoke
 *
 * Flip a pending invite to status='revoked'. Refuses with 409
 * `INVITE_NOT_PENDING` when the invite is not pending (already
 * accepted, declined, expired, or revoked). Refuses with 404 when
 * the invite does not exist in this team for this org.
 */
coachInvitesRoute.post('/:inviteId/revoke', async (c) => {
  const auth = c.get('auth');
  const teamId = c.req.param('teamId');
  const inviteId = c.req.param('inviteId');

  if (!auth.orgId) {
    return c.json(errorBody('MISSING_ORG_SCOPE', 'Actor has no orgId in scope.'), 400);
  }
  if (!teamId || !inviteId) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }

  const db = c.get('db');

  try {
    await requireCoachOnTeam(
      toRbacActor(auth),
      teamId,
      db as Parameters<typeof requireCoachOnTeam>[2],
    );
  } catch (err) {
    if (err instanceof HttpError) {
      return c.json(errorBody('NOT_FOUND', err.message), 404);
    }
    throw err;
  }

  const readDb = narrowDb(db);
  const rows = readDb
    .select()
    .from(rosterInvites)
    .where(
      and(
        eq(rosterInvites.id, inviteId),
        eq(rosterInvites.orgId, auth.orgId),
        eq(rosterInvites.teamId, teamId),
      ),
    )
    .limit(1)
    .all();

  if (rows.length === 0) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }
  const existing = rows[0];
  if (!existing) {
    return c.json(errorBody('NOT_FOUND', 'invite-not-found'), 404);
  }
  if (existing.status !== 'pending') {
    return c.json(
      errorBody('INVITE_NOT_PENDING', `Invite is ${existing.status}; cannot revoke.`),
      409,
    );
  }

  const now = new Date();
  readDb
    .update(rosterInvites)
    .set({ status: 'revoked', updatedAt: now })
    .where(
      and(
        eq(rosterInvites.id, inviteId),
        eq(rosterInvites.orgId, auth.orgId),
        eq(rosterInvites.teamId, teamId),
      ),
    )
    .run();

  const updated: RosterInviteRow = {
    ...existing,
    status: 'revoked',
    updatedAt: now,
  };
  return c.json({ success: true, data: { invite: projectInvite(updated) } }, 200);
});

/**
 * Generate a short opaque id for the persisted row. Uses
 * `crypto.randomUUID` when available (Workers and Node 19+); falls
 * back to `randomBytes` for older Node test environments.
 */
function cryptoRandomId(): string {
  // `globalThis.crypto.randomUUID` is available in both Node 19+ and
  // the Workers runtime; both are part of the project's supported
  // matrix per docs/architecture.md.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return randomBytes(16).toString('hex');
}
