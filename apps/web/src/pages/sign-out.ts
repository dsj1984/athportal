// apps/web/src/pages/sign-out.ts
//
// Server-side sign-out endpoint. POST revokes the active Clerk session
// (so the same session id cannot be reused) and clears the `__session`
// cookie that the Astro Clerk middleware reads on subsequent requests.
// GET is rejected with 405 so the route stays POST-only — sign-out is a
// state-changing action and SHOULD NOT be CSRF-vulnerable via a stray
// link or image tag.
//
// The AC for Task #333 requires:
//   - POST `/sign-out` clears the `__session` cookie (cookie probe by the
//     Story G Playwright fixture).
//   - GET `/sign-out` returns 405 Method Not Allowed.
//
// Apps/web has no direct `astro` dependency yet (the runtime is pulled in
// transitively via `@clerk/astro`). The `APIContext` shape below is the
// minimal contract Astro hands every endpoint — locals, cookies, redirect.
// Replace with `import type { APIRoute, APIContext } from 'astro'` once
// the full Astro toolchain lands in a later Story.
//
// Story #328 (Task #333) — Clerk SDK wiring for the web runtime.

import { clerkClient } from '@clerk/astro/server';

const SESSION_COOKIE = '__session';

// Minimal structural type of the per-request context Astro hands every
// endpoint. Apps/web does not yet declare `astro` as a workspace dep —
// the runtime is pulled in transitively via `@clerk/astro` — so this
// endpoint types the surface it actually consumes (locals, cookies,
// redirect) rather than reach for `import type { APIContext } from 'astro'`.
// Replace with the full Astro types once the toolchain lands.
type SignOutContext = Parameters<typeof clerkClient>[0] & {
  locals: App.Locals;
  cookies: {
    delete(name: string, options?: { path?: string }): void;
  };
  redirect(path: string, status?: number): Response;
};

export const POST = async (context: SignOutContext): Promise<Response> => {
  const auth = context.locals.auth();
  const sessionId = auth.sessionId;

  if (sessionId) {
    // Revoke server-side so the JWT cannot be re-presented. Failures here
    // (e.g. session already revoked, Clerk transient error) must not block
    // the client-side cookie clear — best-effort.
    try {
      await clerkClient(context).sessions.revokeSession(sessionId);
    } catch {
      // Intentionally swallowed: the cookie clear + redirect below is the
      // user-visible contract. Server-side revocation is defense-in-depth.
    }
  }

  // Delete the session cookie the middleware reads on the next request.
  context.cookies.delete(SESSION_COOKIE, { path: '/' });

  return context.redirect('/', 303);
};

export const GET = (): Response =>
  new Response('Method Not Allowed', {
    status: 405,
    headers: { Allow: 'POST' },
  });
