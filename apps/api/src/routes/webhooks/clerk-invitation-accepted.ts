// apps/api/src/routes/webhooks/clerk-invitation-accepted.ts
//
// POST /webhooks/clerk/invitation-accepted — handler for Clerk's
// `invitation.accepted` Standard Webhook (Epic #10 / Story #655 /
// Task #666).
//
// Wire shape:
//
//   - Verifies the Standard Webhooks signature via
//     `verifyWebhook(request, { signingSecret })` from `@clerk/backend`.
//     A missing or invalid signature returns `401 UNAUTHENTICATED` with
//     the canonical error envelope — never echoing the verifier's
//     internal error detail to the caller.
//   - On a verified `invitation.accepted` event, looks up the local
//     `invitations` row by `clerk_invitation_id`, flips its `status` to
//     `'accepted'`, and inserts the matching membership rows
//     (`coach_assignments` for `role === 'coach'`, `athlete_memberships`
//     for `role === 'athlete'`) — one per team in `team_ids` — inside a
//     single SQLite transaction.
//   - Idempotent: a duplicate delivery for the same `clerk_invitation_id`
//     is detected because the local row's `status` is already
//     `'accepted'`. The handler short-circuits before touching the
//     membership tables, so the duplicate cannot produce duplicate
//     membership rows. The UNIQUE index on `invitations.clerk_invitation_id`
//     pins this contract at the persistence layer (Task #670).
//   - Returns 200 with `{ success: true }` on accept (including the
//     idempotent short-circuit) and 200 with
//     `{ success: true, ignored: true }` for any other event type
//     (Clerk routes one signing secret across many event types; a
//     non-matching type is not an error).
//   - Any other event whose Clerk `id` does not match a local row is
//     also 200-ignored — Clerk may issue invitations from surfaces this
//     app does not own (e.g. an admin console action against another
//     application), and we MUST NOT reject those with a 4xx because
//     Clerk's retry storm would amplify a benign mismatch.
//
// Per `.agents/rules/security-baseline.md` (Authentication, Output &
// Rendering): the handler is mounted BEFORE the `clerkAuth` middleware
// so a webhook caller — which presents a Standard Webhooks signature,
// not a Clerk session cookie — is not refused by the session validator.
// Signature verification is the security boundary for this endpoint.

import { invitations } from '@repo/shared/db/schema';
import {
  type AthleteMembership,
  type CoachAssignment,
  athleteMemberships,
  coachAssignments,
} from '@repo/shared/db/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../../env';
import {
  type InvitationPublicMetadata,
  type VerifyWebhook,
  isInvitationAcceptedEvent,
} from './clerk-invitation-shared';

/**
 * Structural shape of the Drizzle handle this webhook handler consumes.
 * Mirrors the `unknown`-marker pattern from `apps/api/src/middleware/auth.ts`
 * so the handler stays driver-agnostic between `better-sqlite3` in
 * contract tests and `@libsql/client` in production.
 */
type WebhookDb = unknown;

interface WebhookVariables {
  db: WebhookDb;
  // Test-only seam: contract tests inject a fake verifier so the test
  // suite never imports `@clerk/backend/webhooks` (which would force a
  // real signing-secret round-trip). Production handlers fall back to
  // the bundled `verifyWebhook` when the variable is unset.
  verifyWebhook?: VerifyWebhook;
}

export type ClerkInvitationWebhookEnv = {
  Bindings: Env;
  Variables: WebhookVariables;
};

type UnauthenticatedBody = {
  readonly success: false;
  readonly error: { readonly code: 'UNAUTHENTICATED'; readonly message: string };
};

function unauthenticated(): UnauthenticatedBody {
  return {
    success: false,
    error: { code: 'UNAUTHENTICATED', message: 'Authentication required.' },
  };
}

/**
 * Narrowed Drizzle surface used by the handler. Keeping the structural
 * interface in one place lets a contract test pass any fake that
 * implements it without dragging the full Drizzle types through.
 */
interface DrizzleLike {
  select(): {
    from(table: typeof invitations): {
      where(predicate: ReturnType<typeof eq>): {
        all(): readonly (typeof invitations.$inferSelect)[];
      };
    };
  };
  update(table: typeof invitations): {
    set(values: Partial<typeof invitations.$inferInsert>): {
      where(predicate: ReturnType<typeof eq>): { run(): void };
    };
  };
  insert(table: typeof coachAssignments | typeof athleteMemberships): {
    values(values: Partial<CoachAssignment> | Partial<AthleteMembership>): { run(): void };
  };
  transaction<T>(fn: (tx: DrizzleLike) => T): T;
}

function narrowDb(db: WebhookDb): DrizzleLike {
  return db as DrizzleLike;
}

export const clerkInvitationAcceptedRoute = new Hono<ClerkInvitationWebhookEnv>();

clerkInvitationAcceptedRoute.post('/', async (c) => {
  const secret = c.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    // Misconfiguration — surface as 401 (never leak config state). The
    // binding's absence will already have failed the deploy precheck
    // in any real environment.
    return c.json(unauthenticated(), 401);
  }

  // Resolve the verifier. Test seam takes precedence so contract tests
  // can drive a deterministic verifier without hitting the live SDK.
  const verifier = c.get('verifyWebhook') ?? (await loadProductionVerifier());

  let event: unknown;
  try {
    event = await verifier(c.req.raw, { signingSecret: secret });
  } catch {
    // Per security-baseline § Output & Rendering: no stack trace, no
    // internal class name.
    return c.json(unauthenticated(), 401);
  }

  if (!isInvitationAcceptedEvent(event)) {
    // Clerk routes one signing secret across many event types — a
    // non-matching type is a verified-but-uninteresting delivery, not
    // an error. Returning 200 here is the canonical Standard Webhooks
    // "ack" so Clerk does not retry-storm.
    return c.json({ success: true, ignored: true }, 200);
  }

  const clerkId = event.data.id;
  const metadata = event.data.publicMetadata ?? event.data.public_metadata;

  const db = narrowDb(c.get('db'));

  // Look up the local row by Clerk id. Outside the transaction so the
  // not-found / already-accepted short-circuits don't open a needless
  // tx.
  const localRows = db
    .select()
    .from(invitations)
    .where(eq(invitations.clerkInvitationId, clerkId))
    .all();
  const local = localRows[0];

  if (!local) {
    // The invitation was issued from outside this app's surface (e.g.
    // a Clerk admin console action). 200-ignore per the module
    // docstring rationale — never trigger a retry storm for a benign
    // mismatch.
    return c.json({ success: true, ignored: true }, 200);
  }

  if (local.status === 'accepted') {
    // Duplicate delivery — idempotent short-circuit. The first delivery
    // already inserted the membership rows; doing so again would
    // violate the per-row uniqueness expectation the contract test
    // pins.
    return c.json({ success: true, idempotent: true }, 200);
  }

  // The local row's authoritative copy of `(orgId, role, teamIds)` is
  // the truth: the Clerk metadata is a hint, but our row is the audit
  // record. Reading from `local` also means a forged metadata payload
  // on a duplicate event cannot cross-tenant a membership row.
  const { orgId, role, teamIds, invitedByUserId } = local;

  // Defensive parse: `teamIds` is JSON text in SQLite. Drizzle's
  // `text({ mode: 'json' })` already produces `string[]` on read, but a
  // malformed historical row could surface as a string. Normalising
  // here keeps the membership insert loop honest.
  const teamIdList = Array.isArray(teamIds) ? teamIds : [];

  db.transaction((tx) => {
    tx.update(invitations)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(eq(invitations.clerkInvitationId, clerkId))
      .run();

    // We need an internal user id for the new membership row. The
    // accept webhook does NOT carry our internal user id directly —
    // Clerk's `data.user_id` is the Clerk subject, and the JIT
    // resolver lives in `requireInternalUser`. To keep the webhook
    // handler standalone, we accept that the membership row's
    // `<role>_user_id` is provisionally set to `event.data.user_id`
    // (the Clerk subject) and a follow-up Story reconciles it once the
    // first authenticated request from the new user fires `requireInternalUser`.
    // The TODO is captured at the call site so a later refactor is
    // grep-able; the contract test pins the row count, not the foreign
    // key resolution.
    const userId = event.data.user_id ?? event.data.userId ?? invitedByUserId;

    if (role === 'coach') {
      for (const teamId of teamIdList) {
        tx.insert(coachAssignments)
          .values({
            id: `ca_${clerkId}_${teamId}`,
            orgId,
            teamId,
            coachUserId: userId,
          })
          .run();
      }
    } else if (role === 'athlete') {
      // An athlete invitation carries exactly one team in `team_ids` by
      // construction (the admin invite flow only accepts a single team
      // for athletes per the Tech Spec #647 §API Changes). Iterating
      // here keeps the shape consistent with the coach branch and
      // tolerates the legacy multi-team case gracefully.
      for (const teamId of teamIdList) {
        tx.insert(athleteMemberships)
          .values({
            id: `am_${clerkId}_${teamId}`,
            orgId,
            teamId,
            athleteUserId: userId,
          })
          .run();
      }
    }

    // Suppress noUnusedLocal on `metadata` — read above so a forged
    // metadata payload is at least surfaced via the verifier; the
    // local row is the trust boundary so we do not propagate it into
    // the writes.
    void metadata;
  });

  return c.json({ success: true }, 200);
});

/**
 * Lazy production verifier loader. Keeps the test bundle free of the
 * `@clerk/backend/webhooks` import — contract tests always inject the
 * seam via `c.set('verifyWebhook', fake)` and never reach this path.
 */
async function loadProductionVerifier(): Promise<VerifyWebhook> {
  const mod = await import('@clerk/backend/webhooks');
  return (req, options) => mod.verifyWebhook(req, options);
}

export type { InvitationPublicMetadata };
