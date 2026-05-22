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
import { type OrgConfigOutput, OrgConfigPatchSchema } from '@repo/shared/schemas/admin/org';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  ALLOWED_LOGO_CONTENT_TYPES,
  type AllowedLogoContentType,
  type LogoUploadSigner,
  MAX_LOGO_BYTES,
  mintLogoUploadUrl,
} from '../../../lib/r2';
import type { RequireInternalUserEnv } from '../../../middleware/auth';
import type { DrizzleSelectChain, DrizzleUpdateChain } from '../../../types/drizzle-structural';

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
      | 'INTERNAL'
      | 'UNSUPPORTED_MEDIA_TYPE'
      | 'PAYLOAD_TOO_LARGE';
    readonly message: string;
  };
}

function errorBody(code: ErrorBody['error']['code'], message: string): ErrorBody {
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

// ---------------------------------------------------------------------------
// Logo upload — POST /logo-upload-url and POST /logo-finalize (Task #675)
// ---------------------------------------------------------------------------

/**
 * Per-request signer slot. The route reads the signer from
 * `c.var.logoUploadSigner` (contract tests inject a stub via middleware);
 * production wires a SigV4 signer at the API entrypoint in a follow-up
 * PR. When no signer is bound the route returns 500 rather than minting
 * a useless URL.
 */
function resolveSigner(c: {
  get: (k: 'logoUploadSigner') => LogoUploadSigner | undefined;
  env: unknown;
}): LogoUploadSigner | null {
  const fromVar = c.get('logoUploadSigner');
  if (fromVar) return fromVar;
  const fromEnv = (c.env as { LOGO_UPLOAD_SIGNER?: LogoUploadSigner } | undefined)
    ?.LOGO_UPLOAD_SIGNER;
  return fromEnv ?? null;
}

interface LogoUploadUrlBody {
  readonly contentType: string;
  readonly contentLength: number;
}

function parseUploadUrlBody(payload: unknown): LogoUploadUrlBody | null {
  if (payload === null || typeof payload !== 'object') return null;
  const ct = (payload as { contentType?: unknown }).contentType;
  const cl = (payload as { contentLength?: unknown }).contentLength;
  if (typeof ct !== 'string' || typeof cl !== 'number') return null;
  return { contentType: ct, contentLength: cl };
}

orgAdminRoute.post('/logo-upload-url', async (c) => {
  const auth = c.get('auth');
  const orgId = resolveActorOrgId(auth.orgId);
  if (orgId === null) {
    return c.json(errorBody('NOT_FOUND', 'Organization not found.'), 404);
  }

  const rawBody = await c.req.json().catch(() => null);
  const body = parseUploadUrlBody(rawBody);
  if (!body) {
    return c.json(
      errorBody(
        'VALIDATION_ERROR',
        'Request body must be { contentType: string, contentLength: number }.',
      ),
      400,
    );
  }

  const signer = resolveSigner(c as unknown as Parameters<typeof resolveSigner>[0]);
  if (!signer) {
    return c.json(errorBody('INTERNAL', 'Upload service is not configured.'), 500);
  }

  const result = await mintLogoUploadUrl({
    orgId,
    input: { contentType: body.contentType, contentLength: body.contentLength },
    signer,
  });

  if (!result.ok) {
    if (result.reason === 'UNSUPPORTED_MEDIA_TYPE') {
      return c.json(
        errorBody(
          'UNSUPPORTED_MEDIA_TYPE',
          `Logo content type must be one of: ${ALLOWED_LOGO_CONTENT_TYPES.join(', ')}.`,
        ),
        400,
      );
    }
    // PAYLOAD_TOO_LARGE
    return c.json(
      errorBody(
        'PAYLOAD_TOO_LARGE',
        `Logo upload must be > 0 bytes and <= ${MAX_LOGO_BYTES} bytes.`,
      ),
      400,
    );
  }

  return c.json(
    { success: true as const, data: { uploadUrl: result.uploadUrl, key: result.key } },
    200,
  );
});

interface LogoFinalizeBody {
  readonly key: string;
}

function parseFinalizeBody(payload: unknown): LogoFinalizeBody | null {
  if (payload === null || typeof payload !== 'object') return null;
  const key = (payload as { key?: unknown }).key;
  if (typeof key !== 'string' || key.length === 0) return null;
  return { key };
}

orgAdminRoute.post('/logo-finalize', async (c) => {
  const auth = c.get('auth');
  const orgId = resolveActorOrgId(auth.orgId);
  if (orgId === null) {
    return c.json(errorBody('NOT_FOUND', 'Organization not found.'), 404);
  }

  const rawBody = await c.req.json().catch(() => null);
  const body = parseFinalizeBody(rawBody);
  if (!body) {
    return c.json(errorBody('VALIDATION_ERROR', 'Request body must be { key: string }.'), 400);
  }

  // Cross-tenant guard: the key was minted under `logos/<orgId>/...` by
  // `buildLogoKey` — refuse to persist a key whose prefix does not
  // match the actor's org. Without this guard a finalize call could
  // adopt a foreign org's uploaded asset.
  const expectedPrefix = `logos/${orgId}/`;
  if (!body.key.startsWith(expectedPrefix)) {
    return c.json(
      errorBody('VALIDATION_ERROR', 'Logo key does not belong to this organization.'),
      400,
    );
  }

  const db = c.get('db') as OrgDb | undefined;
  if (!db || typeof db.update !== 'function') {
    return c.json(errorBody('INTERNAL', 'Service temporarily unavailable.'), 500);
  }

  const updated = db
    .update(organizations)
    .set({ logoR2Key: body.key, updatedAt: new Date() })
    .where(eq(organizations.id, orgId))
    .returning()
    .all();

  const row = updated[0];
  if (!row) {
    return c.json(errorBody('NOT_FOUND', 'Organization not found.'), 404);
  }

  const base = (c.env as { R2_PUBLIC_BASE_URL?: string } | undefined)?.R2_PUBLIC_BASE_URL;
  return c.json(
    {
      success: true as const,
      data: { logoUrl: deriveLogoUrl(row.logoR2Key ?? null, base) },
    },
    200,
  );
});

// Re-export the upload type so the contract test can declare the signer
// stub against the same shape the route consumes.
export type { AllowedLogoContentType, LogoUploadSigner };
