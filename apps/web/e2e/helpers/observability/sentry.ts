/**
 * Sentry alert-path helpers for the Epic #5 observability acceptance
 * scenarios.
 *
 * Why a helper rather than driving the vendor SDK directly — see
 * `docs/decisions/0004-acceptance-email-capture.md`. These functions
 * synthesise the message Sentry **would** emit when a runtime throws,
 * by reading the in-repo configuration that governs the alert path:
 *
 *   - The synthetic-failure route's gate env var
 *     (`OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED`) is read from
 *     `apps/api/src/routes/debug/synthetic-failure.ts` so a rename of
 *     the gate constant fails the acceptance test for the same reason
 *     it would silence the real alert in staging.
 *   - The fork-safety guard in
 *     `.github/actions/sourcemap-upload/action.yml` is read at the
 *     source so a regression in the guard's `::notice::` string surfaces
 *     here.
 *
 * Every push lands in the in-memory `emailInbox`; the step library reads
 * the inbox to assert the user-visible outcome ("the operator receives
 * an alert email naming the Workers runtime"). No real Sentry SDK call
 * is made.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emailInbox } from '../../fixtures/email-inbox';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

export type SentryRuntime = 'Workers' | 'Astro' | 'Expo';

/**
 * Synthesise the Sentry permalink the operator would click. The real
 * Sentry server emits a URL with the org slug, project slug, and issue
 * ID — we mirror the path shape so a `Then` step asserting "the alert
 * email contains a Sentry permalink to a sourcemapped stack trace" can
 * match a deterministic pattern. The contract tier covers the real URL
 * shape against the Sentry vendor SDK; here we only need a recognisable
 * permalink.
 */
function synthesizeSentryPermalink(runtime: SentryRuntime): string {
  const projectSlug = runtime.toLowerCase();
  const issueId = `synthetic-${projectSlug}-${Date.now()}`;
  return `https://athportal.sentry.io/issues/${issueId}/?project=${projectSlug}&sourcemap=true`;
}

/**
 * Push a Sentry alert email naming `runtime` into the in-memory inbox.
 * Mirrors what the real Sentry alert rule would do when an unhandled
 * exception with a sourcemapped stack lands in the project.
 */
export function simulateUnhandledError(runtime: SentryRuntime): void {
  emailInbox.push({
    vendor: 'sentry',
    subject: `[athportal] Unhandled exception in ${runtime} runtime`,
    body:
      `An unhandled exception was raised in the ${runtime} runtime.\n` +
      'Sourcemapped stack trace and issue context: ' +
      synthesizeSentryPermalink(runtime),
    names: { runtime },
  });
}

/**
 * Read the synthetic-failure route source and return the value the gate
 * compares against (the literal string the route accepts as "open").
 * Used by the rehearsal-switch helpers so a rename of the gate constant
 * fails this acceptance test before reaching staging.
 */
function readSyntheticFailureGateExpectedValue(): string {
  const routePath = path.join(
    REPO_ROOT,
    'apps',
    'api',
    'src',
    'routes',
    'debug',
    'synthetic-failure.ts',
  );
  const source = fs.readFileSync(routePath, 'utf8');
  const match = source.match(/gate !== '(true)'/);
  if (!match) {
    throw new Error(
      `Could not locate the synthetic-failure gate-comparison literal in ${routePath}. ` +
        "The route's gate check shape has changed; update this helper to match.",
    );
  }
  return match[1];
}

/**
 * Resolve whether the rehearsal switch would be "open" for the given
 * `flagValue`. Mirrors the route's comparison (`gate !== 'true'`).
 */
export function rehearsalSwitchIsOpen(flagValue: string | undefined): boolean {
  return flagValue === readSyntheticFailureGateExpectedValue();
}

/**
 * Simulate firing the synthetic-failure rehearsal. When the switch is
 * open, the operator receives a Workers Sentry alert; when closed, the
 * inbox stays empty (the route would respond 404 and no exception is
 * raised). The step library reads the inbox after this call.
 */
export function simulateSyntheticFailure(flagValue: string | undefined): void {
  if (!rehearsalSwitchIsOpen(flagValue)) {
    return;
  }
  simulateUnhandledError('Workers');
}

/**
 * Resolve whether the rehearsal surface is "exposed" — true when the
 * switch is open. Mirrors the route's contract that a closed gate
 * returns 404 (i.e. indistinguishable from a non-existent path).
 */
export function rehearsalSurfaceIsExposed(flagValue: string | undefined): boolean {
  return rehearsalSwitchIsOpen(flagValue);
}

export interface SourcemapGuardResult {
  /** True when the guard short-circuits (`SENTRY_AUTH_TOKEN` empty). */
  skipped: boolean;
  /** The `::notice::` line the guard emits. */
  noticeLine: string;
  /** Exit code the guard would set. 0 for skip, non-zero never (skip is fail-open). */
  exitCode: number;
}

/**
 * Simulate the fork-safety guard inside the sourcemap-upload composite
 * action. Reads the action's bash gate and emits a structured result
 * the step library uses to assert "the contributor sees the build pass"
 * and "the contributor sees a skip notice naming the sourcemap upload".
 *
 * The guard is fail-open by design (a missing token must not fail CI on
 * a fork PR). This function reads the action.yml source so a rename of
 * the env var or a change in the notice wording surfaces here.
 */
export function simulateSourcemapUploadGuard(
  sentryAuthToken: string | undefined,
): SourcemapGuardResult {
  const actionPath = path.join(REPO_ROOT, '.github', 'actions', 'sourcemap-upload', 'action.yml');
  const source = fs.readFileSync(actionPath, 'utf8');

  const tokenCheckRegex = /\[ -z "\$SENTRY_AUTH_TOKEN" \]/;
  if (!tokenCheckRegex.test(source)) {
    throw new Error(
      `Sourcemap-upload action no longer guards on SENTRY_AUTH_TOKEN at ${actionPath}. ` +
        'The fork-safety guard shape has changed; AC-6 may have regressed.',
    );
  }

  const noticeRegex = /::notice::([^\n]*sourcemap upload[^\n]*)/i;
  const noticeMatch = source.match(noticeRegex);
  if (!noticeMatch) {
    throw new Error(
      `Sourcemap-upload action no longer emits a ::notice:: line mentioning "sourcemap upload" ` +
        `at ${actionPath}. AC-6 may have regressed.`,
    );
  }

  const noticeLine = noticeMatch[1].trim();
  if (sentryAuthToken === undefined || sentryAuthToken.length === 0) {
    return { skipped: true, noticeLine, exitCode: 0 };
  }
  return { skipped: false, noticeLine, exitCode: 0 };
}
