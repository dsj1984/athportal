// apps/api/src/routes/webhooks/clerk-user-updated.ts
//
// POST /webhooks/clerk/user-updated — handler for Clerk's `user.updated`
// Standard Webhook (Story #1054 / F33).
//
// Purpose: keep the Clerk-promoted display name fresh. Onboarding
// promotes the Clerk `firstName` / `lastName` into `users` in the same
// transaction that promotes the verified email (see `onboard.ts`,
// mirroring the ADR-005 email-promotion precedent). This webhook is the
// post-onboarding counterpart — when a user edits their profile name in
// Clerk, this re-promotes the new value into the local `users` row.
//
// Wire shape:
//
//   - Verifies the Standard Webhooks (Svix) signature via
//     `verifyWebhook(request, { signingSecret })` from `@clerk/backend`.
//     A missing or invalid signature returns `401 UNAUTHENTICATED` with
//     the canonical error envelope — never echoing the verifier's
//     internal error detail. Signature verification is the security
//     boundary for this endpoint (security-baseline § Input Validation,
//     § Authentication): the payload is NEVER trusted before the
//     signature is verified.
//   - On a verified `user.updated` event, resolves the local `users` row
//     by `clerk_subject_id = event.data.id` and writes the normalised
//     `first_name` / `last_name`. Empty / whitespace-only Clerk values
//     normalise to `null` so a cleared Clerk name clears the local copy
//     and the roster projection falls back to the email-derived name.
//   - Idempotent by construction: the update is a last-writer-wins set of
//     two columns to the values carried by the (verified) event. A
//     duplicate delivery re-applies the same values — no second-effect
//     hazard.
//   - Returns 200 with `{ success: true }` on update, 200 with
//     `{ success: true, ignored: true }` for any other event type or for
//     a verified `user.updated` whose Clerk id matches no local row
//     (Clerk routes one signing secret across many event types and may
//     fire updates for subjects this app has never provisioned — a 4xx
//     would trigger Clerk's retry storm for a benign mismatch).
//
// PII: the handler emits NO log lines. Names are PII per
// security-baseline § Data Leakage & Logging — they never reach a log.
//
// Mounted BEFORE the `clerkAuth` middleware (see `apps/api/src/index.ts`)
// because a webhook caller presents a Standard Webhooks signature, not a
// Clerk session cookie.

import { users } from '@repo/shared/db/schema';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Env } from '../../env';
import {
  type VerifyWebhook,
  isUserUpdatedEvent,
  normalizeName,
} from './clerk-user-updated-shared';

/**
 * Structural shape of the Drizzle handle this webhook handler consumes.
 * Mirrors the `unknown`-marker pattern from `clerk-invitation-accepted.ts`
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

export type ClerkUserUpdatedWebhookEnv = {
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
    from(table: typeof users): {
      where(predicate: ReturnType<typeof eq>): {
        all(): readonly (typeof users.$inferSelect)[];
      };
    };
  };
  update(table: typeof users): {
    set(values: Partial<typeof users.$inferInsert>): {
      where(predicate: ReturnType<typeof eq>): { run(): void };
    };
  };
}

function narrowDb(db: WebhookDb): DrizzleLike {
  return db as DrizzleLike;
}

async function loadProductionVerifier(): Promise<VerifyWebhook> {
  const mod = await import('@clerk/backend/webhooks');
  return (req, options) => mod.verifyWebhook(req, options);
}

export const clerkUserUpdatedRoute = new Hono<ClerkUserUpdatedWebhookEnv>();

clerkUserUpdatedRoute.post('/', async (c) => {
  const secret = c.env.CLERK_WEBHOOK_SIGNING_SECRET;
  if (!secret) {
    // Misconfiguration — surface as 401 (never leak config state). The
    // binding's absence will already have failed the deploy precheck in
    // any real environment.
    return c.json(unauthenticated(), 401);
  }

  // Resolve the verifier. Test seam takes precedence so contract tests
  // can drive a deterministic verifier without hitting the live SDK.
  const verifier = c.get('verifyWebhook') ?? (await loadProductionVerifier());

  let event: unknown;
  try {
    // SECURITY: verify the Svix signature BEFORE reading any field off
    // the payload. An unverified payload is untrusted input.
    event = await verifier(c.req.raw, { signingSecret: secret });
  } catch {
    // Per security-baseline § Output & Rendering: no stack trace, no
    // internal class name.
    return c.json(unauthenticated(), 401);
  }

  if (!isUserUpdatedEvent(event)) {
    // Clerk routes one signing secret across many event types — a
    // non-matching type is a verified-but-uninteresting delivery, not an
    // error. 200-ack so Clerk does not retry-storm.
    return c.json({ success: true, ignored: true }, 200);
  }

  const clerkSubjectId = event.data.id;
  const db = narrowDb(c.get('db'));

  // Resolve the local row by Clerk subject id. The webhook may fire for a
  // subject this app never provisioned (e.g. a user created in a sibling
  // application sharing the Clerk instance) — 200-ignore that case.
  const localRows = db
    .select()
    .from(users)
    .where(eq(users.clerkSubjectId, clerkSubjectId))
    .all();
  const local = localRows[0];
  if (!local) {
    return c.json({ success: true, ignored: true }, 200);
  }

  // Re-promote the Clerk name. Empty / whitespace values normalise to
  // null so the roster fallback triggers. `updatedAt` is bumped so the
  // audit timestamp reflects the profile edit.
  db.update(users)
    .set({
      firstName: normalizeName(event.data.first_name),
      lastName: normalizeName(event.data.last_name),
      updatedAt: new Date(),
    })
    .where(eq(users.clerkSubjectId, clerkSubjectId))
    .run();

  return c.json({ success: true }, 200);
});
