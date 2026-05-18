// apps/mobile/src/sentry.ts
//
// Expo Sentry init wrapper. The native runtime mounts this once from
// the app entry on cold start (Story #255). The wrapper:
//   - Reads the DSN from Expo's runtime config at `extra.sentryDsnMobile`
//     so the value flows through `app.config.ts` rather than baking into
//     the bundle.
//   - Initializes @sentry/react-native with the resolved DSN.
//   - Is a no-op when the DSN is unset (returns null), so the app keeps
//     booting in local dev / EAS preview builds that don't carry the
//     secret.
//
// The sentry-expo plugin registered in `app.config.ts` handles native
// install + sourcemap upload at build time; this module owns the
// runtime initialization side only.

import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

interface SentryExtra {
  sentryDsnMobile?: string;
  sentryRelease?: string;
}

function readExtra(): SentryExtra {
  const expoConfig = Constants?.expoConfig;
  const extra = (expoConfig?.extra ?? {}) as SentryExtra;
  return extra;
}

/**
 * Initialize the mobile-side Sentry client.
 *
 * Idempotent in spirit: callers should only invoke this once from the
 * app entry. Returns `null` when no DSN is configured so the boot path
 * stays clean.
 */
export function initSentry(): ReturnType<typeof Sentry.init> | null {
  const { sentryDsnMobile, sentryRelease } = readExtra();
  if (!sentryDsnMobile) {
    return null;
  }

  return Sentry.init({
    dsn: sentryDsnMobile,
    release: sentryRelease,
  });
}
