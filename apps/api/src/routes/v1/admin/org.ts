// apps/api/src/routes/v1/admin/org.ts
//
// GET / PATCH /api/v1/admin/org — admin org configuration endpoints
// (Epic #10 / Story #656 / Task #673).
//
// Replaces the Story #654 placeholder that previously responded 501
// NOT_IMPLEMENTED on every verb. The mount point in `./index.ts` is
// unchanged — the URL stays the same across the placeholder-to-real
// handler swap, which is the load-bearing contract Story #654 set up.
//
// Auth chain reaching this router:
//
//   clerkAuth → requireInternalUser → requireOnboarded → requireRole('org_admin')
//
// `requireRole('org_admin')` runs on the admin tree mount in
// `./index.ts`, so by the time these handlers fire `c.var.auth.role`
// is `org_admin` (or `dev_admin` — the role gate's platform-root
// short-circuit). Cross-tenant defense is enforced HERE in the handler
// by pinning every read and write to `auth.orgId`. A `dev_admin` with
// `orgId: null` cannot resolve a target org and receives `404 NOT_FOUND`
// rather than masquerading as any org.
//
// Wire shape (success): `{ success: true, data: OrgConfigOutput }` per
// Tech Spec #318 §API and the published Zod schema in
// `@repo/shared/schemas/admin/org`. The `sports`, `contactEmail`, and
// `contactPhone` fields are surfaced as placeholders (`[]` / `null`)
// because the matching columns are not on `organizations` yet — a
// follow-up Story under Epic #10 lands those columns and the client
// form skeleton already speaks the final shape.

import { organizations } from '@repo/shared/db/schema';
import {
  OrgConfigPatchSchema,
  type OrgConfigOutput,
} from '@repo/shared/schemas/admin/org';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import type {
  DrizzleSelectChain,
  DrizzleUpdateChain,
} from '../../../types/drizzle-structural';

/**
 * Structural narrowing of the Drizzle handle this router consumes.
 * Same rationale as `apps/api/src/routes/v1/users/role.ts`: the
 * middleware carries the handle as `unknown`, and each consumer pins
 * the precise method surface it uses.
 */
interface OrgDb {
  select: (cols?: unknown) => DrizzleSelectChain<typeof organizations.$inferSelect>;
  update: (table: unknown) => DrizzleUpdateChain<typeof organizations.$inferSelect>;
}

type OrgRow = typeof organizations.$inferSelect;

interface ErrorBody {
  readonly success: false;
  readonly error: {
    readonly code:
      | 'VALIDATION_ERROR'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'INTERNAL';
    readonly message: string;
  };
}

function errorBody(
  code: ErrorBody['error']['code'],
  message: string,
): ErrorBody {
  return { success: false, error: { code, message } };
}

/**
 * Derive a public logo URL from the stored R2 object key. When the
 * `R2_PUBLIC_BASE_URL` binding is wired (Task #675 / R2 endpoints
 * Story step) the handler returns `${base}/${key}`; until then, or
 * when no logo has been uploaded, the field is `null`.
 *
 * Kept tiny and pure so a contract test can exercise the handler
 * without needing to mock R2.
 */
function deriveLogoUrl(logoR2Key: string | null, base: string | undefined): string | null {
  if (!logoR2Key) return null;
  if (!base) return null;
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${trimmed}/${logoR2Key}`;
}

function toOutput(row: OrgRow, base: string | undefined): OrgConfigOutput {
  return {
    id: row.id,
    name: row.name,
    // Placeholder surfaces — see file header.
    sports: [],
    contactEmail: null,
    contactPhone: null,
    primaryColorHex: row.primaryColorHex ?? null,
    logoUrl: deriveLogoUrl(row.logoR2Key ?? null, base),
  };
}

/**
 * Resolve the actor's org id. Returns `null` when no org is in scope —
 * the caller surfaces this as `NOT_FOUND` rather than `FORBIDDEN` to
 * avoid leaking whether a particular org exists.
 */
function resolveActorOrgId(orgId: string | null | undefined): string | null {
  if (typeof orgId !== 'string' || orgId.length === 0) return null;
  return orgId;
}

export const orgAdminRoute = new Hono<RequireInternalUserEnv>();

orgAdminRoute.get('/', (c) => {
  const auth = c.get('auth');
  const orgId = resolveActorOrgId(auth.orgId);
  if (orgId === null) {
    return c.json(errorBody('NOT_FOUND', 'Organization not found.'), 404);
  }

  const db = c.get('db') as OrgDb | undefined;
  if (!db || typeof db.select !== 'function') {
    return c.json(errorBody('INTERNAL', 'Service temporarily unavailable.'), 500);
  }

  const rows = db.select().from(organizations).where(eq(organizations.id, orgId)).all();
  const row = rows[0];
  if (!row) {
    return c.json(errorBody('NOT_FOUND', 'Organization not found.'), 404);
  }

  const base = (c.env as { R2_PUBLIC_BASE_URL?: string } | undefined)?.R2_PUBLIC_BASE_URL;
  return c.json({ success: true as const, data: toOutput(row, base) }, 200);
});

orgAdminRoute.patch('/', async (c) => {
  const auth = c.get('auth');
  const orgId = resolveActorOrgId(auth.orgId);
  if (orgId === null) {
    return c.json(errorBody('NOT_FOUND', 'Organization not found.'), 404);
  }

  const rawBody = await c.req.json().catch(() => null);
  const parsed = OrgConfigPatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    // Surface the first issue path / message — keep the body terse so
    // we never echo a stack trace or framework-internal detail.
    const issue = parsed.error.issues[0];
    const message = issue
      ? `${issue.path.join('.') || 'body'}: ${issue.message}`
      : 'Request body is invalid.';
    return c.json(errorBody('VALIDATION_ERROR', message), 400);
  }

  const update = parsed.data;

  const db = c.get('db') as OrgDb | undefined;
  if (!db || typeof db.update !== 'function') {
    return c.json(errorBody('INTERNAL', 'Service temporarily unavailable.'), 500);
  }

  // Build the set payload from only the keys the caller supplied — a
  // missing key leaves the column untouched; an explicit `null` clears
  // the (nullable) branding columns.
  const setPayload: Partial<typeof organizations.$inferSelect> & {
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (update.name !== undefined) setPayload.name = update.name;
  if (update.primaryColorHex !== undefined) {
    setPayload.primaryColorHex = update.primaryColorHex;
  }
  if (update.logoR2Key !== undefined) {
    setPayload.logoR2Key = update.logoR2Key;
  }

  const updated = db
    .update(organizations)
    .set(setPayload)
    .where(eq(organizations.id, orgId))
    .returning()
    .all();

  const row = updated[0];
  if (!row) {
    return c.json(errorBody('NOT_FOUND', 'Organization not found.'), 404);
  }

  const base = (c.env as { R2_PUBLIC_BASE_URL?: string } | undefined)?.R2_PUBLIC_BASE_URL;
  return c.json({ success: true as const, data: toOutput(row, base) }, 200);
});
