// apps/web/src/lib/ssrAuthGate.ts
//
// SSR auth gates for Astro pages. Generalises the pattern PR #940 added
// for `/app/coach/teams/:teamId/roster.astro` so every protected web
// surface enforces the same "no 200-with-chrome to anonymous / non-
// authorised callers" posture. Story #952 / F1 + F4.
//
// Two gates, one shape:
//
//   - `requireSignedIn(ctx)` — anonymous → 302 `/sign-in`, signed-in →
//     `null`. Used by `/dashboard` and any future surface that just
//     needs "must be signed in" without a role check.
//   - `requireAdminSsr(ctx)` — anonymous → 302 `/sign-in`, signed-in
//     non-admin → 404 Not Found (cross-tenant non-enumeration), admin
//     → `null`. The non-admin 404 (not 403) is deliberate: Epic #11
//     AC-2/AC-3 mandates that the *existence* of admin surfaces is not
//     leaked to non-admin signed-in users.
//
// Both gates return a `Response` when they want to short-circuit and
// `null` when the caller may proceed. Page frontmatter uses:
//
//   const gate = await requireAdminSsr(Astro);
//   if (gate) return gate;
//
// The "did the API say I'm an admin?" probe targets `GET /api/v1/admin/
// teams` because:
//   1. It is the only admin endpoint guaranteed to exist on every Epic.
//   2. The list-fetch with no filters returns small bodies (rows are
//      paginated; default page is bounded).
//   3. The same probe pattern is what `apps/web/src/pages/app/coach/
//      teams/[teamId]/roster.astro` uses, so reviewers can audit one
//      shape across both gates.

/**
 * Structural type of the per-request context an Astro page hands to
 * its frontmatter. Pages already expose `Astro.locals.auth()` (Clerk),
 * `Astro.request` (the Fetch `Request`), and `Astro.redirect` — those
 * are the only members this helper needs.
 *
 * Apps/web does not declare `astro` as a direct workspace dep, so we
 * structurally-type the surface we consume rather than reach for
 * `import type { APIContext } from 'astro'`. Same posture
 * `sign-out.ts` and `dev/sign-in-as/[persona].ts` take.
 */
export interface SsrAuthContext {
  locals: {
    auth: () => { userId: string | null };
  };
  request: Request;
  redirect: (path: string, status?: number) => Response;
}

/**
 * Options injection seam for tests. Production callers omit both.
 */
export interface SsrAdminGateOptions {
  /** Base URL of the API the page probes. Defaults to `process.env.API_BASE_URL` or `http://localhost:8787`. */
  apiBaseUrl?: string;
  /** Fetch implementation. Defaults to the global. */
  fetchImpl?: typeof fetch;
}

const SIGN_IN_PATH = '/sign-in';
const ADMIN_PROBE_PATH = '/api/v1/admin/teams';

/**
 * Options accepted by `requireSignedIn`.
 */
export interface RequireSignedInOptions {
  /**
   * Path the caller should be returned to after a successful sign-in.
   * When provided, the redirect target becomes
   * `/sign-in?redirect_url=<encoded>` so Clerk completes the round-trip
   * back to the originating page. Omit for surfaces (like `/dashboard`)
   * where a bare `/sign-in` redirect is sufficient.
   */
  returnTo?: string;
}

/**
 * Anonymous → 302 `/sign-in` (optionally `?redirect_url=<returnTo>`).
 * Signed-in → `null` (caller proceeds).
 *
 * @returns A redirect `Response` when the caller is anonymous,
 *   otherwise `null`.
 */
export function requireSignedIn(
  ctx: SsrAuthContext,
  options: RequireSignedInOptions = {},
): Response | null {
  const userId = ctx.locals.auth().userId;
  if (typeof userId !== 'string' || userId.length === 0) {
    const target =
      typeof options.returnTo === 'string' && options.returnTo.length > 0
        ? `${SIGN_IN_PATH}?redirect_url=${encodeURIComponent(options.returnTo)}`
        : SIGN_IN_PATH;
    return ctx.redirect(target, 302);
  }
  return null;
}

/**
 * Anonymous → 302 `/sign-in`. Signed-in non-admin → 404 (non-
 * enumeration). Admin → `null` (caller proceeds).
 *
 * The admin determination is server-side: the helper probes
 * `GET /api/v1/admin/teams` with the request's cookies. The API edge
 * runs `requireRole('org_admin')` on every `/api/v1/admin/*` route, so
 * a 403 from the API translates to a 404 here. Network errors collapse
 * to the same 404 — we'd rather show the user a generic Not Found than
 * leak an internal-error stack to a non-admin who got partway in.
 *
 * @returns A short-circuit `Response` when the caller should not see
 *   the page, otherwise `null`.
 */
export async function requireAdminSsr(
  ctx: SsrAuthContext,
  options: SsrAdminGateOptions = {},
): Promise<Response | null> {
  const signedIn = requireSignedIn(ctx);
  if (signedIn !== null) return signedIn;

  const apiBaseUrl = options.apiBaseUrl ?? process.env.API_BASE_URL ?? 'http://localhost:8787';
  const fetchImpl = options.fetchImpl ?? fetch;
  const cookieHeader = ctx.request.headers.get('cookie') ?? '';

  const probe = await fetchImpl(`${apiBaseUrl}${ADMIN_PROBE_PATH}`, {
    headers: { accept: 'application/json', cookie: cookieHeader },
  }).catch(() => null);

  if (probe === null || !probe.ok) {
    return new Response('Not Found', { status: 404 });
  }
  return null;
}
