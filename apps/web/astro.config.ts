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

import react from '@astrojs/react';
import sentry from '@sentry/astro';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

const dsn = import.meta.env.SENTRY_DSN_WEB ?? process.env.SENTRY_DSN_WEB;
const release = process.env.RELEASE_SHA;

const integrations = [
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

export default defineConfig({
  integrations,
  vite: {
    plugins: [tailwindcss()],
  },
});
