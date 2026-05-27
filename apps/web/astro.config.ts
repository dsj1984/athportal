// apps/web/astro.config.ts
//
// Astro config for the web runtime. Registers the React renderer and the
// Tailwind v4 Vite plugin (Story #711 / Epic #702 design-system foundation).
// Mounts @sentry/astro when the build is given a DSN; when SENTRY_DSN_WEB
// is unset (local dev, preview), the Sentry integration registration is
// skipped entirely so `astro build` still succeeds.
//
// Release tag is sourced from process.env.RELEASE_SHA — set by CI, blank
// in local dev. The sourcemap-upload bridge consumes SENTRY_AUTH_TOKEN
// at build time only (never at runtime).
//
// Story #255 — Sentry baseline init across all three runtimes.
// Story #711 — Tailwind v4 + React island foundation.
// Story #753 — SSR migration (`@astrojs/node` standalone). Task #756 verified
// `pnpm --filter @repo/web build` exits 0 with `SENTRY_DSN_WEB` both unset
// and set to a dummy value — Sentry's conditional registration is preserved
// verbatim from the pre-SSR config. The adapter choice is locked for the
// MVP; the Cloudflare adapter swap is deferred to Epic #27 (Tech Spec #743).

import node from '@astrojs/node';
import react from '@astrojs/react';
import clerk from '@clerk/astro';
import sentry from '@sentry/astro';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const dsn = import.meta.env.SENTRY_DSN_WEB ?? process.env.SENTRY_DSN_WEB;
const release = process.env.RELEASE_SHA;

const integrations = [
  // Clerk integration must be registered explicitly so the SSR build
  // can resolve `virtual:@clerk/astro/config` from `@clerk/astro/components`.
  // Story #753 / Epic #741.
  clerk(),
  react(),
  ...(dsn
    ? [
        sentry({
          dsn,
          release,
        }),
      ]
    : []),
];

// Story #753 / Epic #741 — SSR migration. Clerk middleware requires a
// server runtime; flip `output: 'server'` and adopt the @astrojs/node
// standalone adapter. Per-page `export const prerender = true;` opts
// static pages back into static prerender (see Task #755). The Cloudflare
// adapter swap is deferred to Epic #27.
export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations,
  vite: {
    plugins: [tailwindcss()],
    // Load `.env` from the repo root so there is one source of truth
    // for environment configuration across @repo/api and @repo/web.
    // Without this, Astro/Vite would look for `.env` inside `apps/web/`
    // and a fresh worktree would miss the operator's PUBLIC_CLERK_*
    // and DATABASE_URL keys (Story #760).
    envDir: '../../',
    // Local-dev proxy: forward `/api/*` to the Node-hosted Hono API on
    // port 8787 (see `apps/api/src/local.ts`). Production wiring is a
    // single Cloudflare worker that serves both surfaces from one
    // origin (Epic #27); locally we run two processes on two ports, so
    // without this proxy every browser fetch from `/app/*` to `/api/*`
    // returns the Astro 404 page. The dev-only proxy makes the two
    // halves behave like one origin without changing any client code.
    server: {
      proxy: {
        '/api': {
          target: process.env.API_BASE_URL ?? 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
  },
});
