// apps/mobile/app.config.ts
//
// Expo app configuration. Registers the `sentry-expo` plugin with
// organization / project / authToken sourced from environment variables
// at build time, and surfaces the runtime DSN through `extra` so the
// init wrapper (`src/sentry.ts`) can read it via `expo-constants`.
//
// When SENTRY_DSN_MOBILE is unset the plugin still loads (config-only),
// and the runtime wrapper short-circuits to a no-op — supporting local
// dev and EAS preview builds that don't carry the secret.
//
// Story #255 — Sentry baseline init across all three runtimes.

import type { ExpoConfig } from 'expo/config';

const dsn = process.env.SENTRY_DSN_MOBILE ?? '';
const sentryOrg = process.env.SENTRY_ORG ?? '';
const sentryProject = process.env.SENTRY_PROJECT_MOBILE ?? process.env.SENTRY_PROJECT ?? '';
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN ?? '';
const release = process.env.RELEASE_SHA ?? '';

const config: ExpoConfig = {
  name: 'athportal',
  slug: 'athportal',
  scheme: 'athportal',
  version: '0.0.0',
  orientation: 'portrait',
  plugins: [
    [
      'sentry-expo',
      {
        organization: sentryOrg,
        project: sentryProject,
        authToken: sentryAuthToken,
      },
    ],
  ],
  extra: {
    sentryDsnMobile: dsn,
    sentryRelease: release,
  },
};

export default config;
