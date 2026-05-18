/**
 * Observability step library — Epic #5 acceptance scenarios.
 *
 * Binds the seven `.feature` files under
 * `tests/features/observability/` to the in-memory `EmailInbox` /
 * `LogSink` fixtures and the helpers under
 * `apps/web/e2e/helpers/observability/`. Every step body asserts a
 * user-visible outcome — "the operator receives an alert email naming
 * X" — and never touches `/api/` URL literals, HTTP status codes, DOM
 * selectors, or raw SQL, per `scripts/lint-steps.mjs` § Forbidden
 * patterns.
 *
 * The rationale for an in-process fake (rather than a Mailpit
 * container) lives in `docs/decisions/0004-acceptance-email-capture.md`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';
import { emailInbox, logSink, resetObservabilityState } from '../fixtures/email-inbox';
import {
  assertAVendorIsDocumented,
  bodyKeysAllowlistSize,
  readRedactionRunbookReferences,
  simulateBudgetOverage,
  simulateRequestCompletionLogging,
} from '../helpers/observability/budget';
import {
  type ProbeName,
  assertProbeIsConfigured,
  simulateProbeFailure,
} from '../helpers/observability/probe';
import {
  type SourcemapGuardResult,
  rehearsalSurfaceIsExposed,
  simulateSourcemapUploadGuard,
  simulateSyntheticFailure,
  simulateUnhandledError,
} from '../helpers/observability/sentry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const { Given, When, Then, Before } = createBdd();

interface ObservabilityScenarioState {
  rehearsalFlag: string | undefined;
  lastRequestId: string | undefined;
  sourcemapGuard: SourcemapGuardResult | undefined;
  documentedVendor: string | undefined;
  forkPullRequestOpen: boolean;
}

let state: ObservabilityScenarioState = freshState();

function freshState(): ObservabilityScenarioState {
  return {
    rehearsalFlag: undefined,
    lastRequestId: undefined,
    sourcemapGuard: undefined,
    documentedVendor: undefined,
    forkPullRequestOpen: false,
  };
}

Before(async () => {
  resetObservabilityState();
  state = freshState();
});

// ────────────────────────────────────────────────────────────────────────────
// AC-1 — Sentry alert path (one scenario per runtime).
// ────────────────────────────────────────────────────────────────────────────

Given('the Workers API is deployed to staging', async () => {
  // Staging-deploy preconditions are tracked via the deploy workflow's
  // audit row in docs/ops/observability-budget.md. The acceptance tier
  // asserts only the alert path; the deploy itself is owned by ADR-013.
});

Given('the Astro web app is deployed to staging', async () => {
  // See note on the Workers Given.
});

Given('the Expo mobile app is running on a staging build', async () => {
  // See note on the Workers Given.
});

When('an unhandled error is thrown while serving a request', async () => {
  simulateUnhandledError('Workers');
});

When('an unhandled error is thrown while rendering a page', async () => {
  simulateUnhandledError('Astro');
});

When('an unhandled error is thrown during a user interaction', async () => {
  simulateUnhandledError('Expo');
});

Then('the operator receives an alert email naming the Workers runtime', async () => {
  const matches = emailInbox.findAll((r) => r.vendor === 'sentry' && r.names.runtime === 'Workers');
  expect(matches.length).toBeGreaterThan(0);
  expect(matches[0].subject).toContain('Workers');
});

Then('the operator receives an alert email naming the Astro runtime', async () => {
  const matches = emailInbox.findAll((r) => r.vendor === 'sentry' && r.names.runtime === 'Astro');
  expect(matches.length).toBeGreaterThan(0);
  expect(matches[0].subject).toContain('Astro');
});

Then('the operator receives an alert email naming the Expo runtime', async () => {
  const matches = emailInbox.findAll((r) => r.vendor === 'sentry' && r.names.runtime === 'Expo');
  expect(matches.length).toBeGreaterThan(0);
  expect(matches[0].subject).toContain('Expo');
});

Then('the alert email contains a Sentry permalink to a sourcemapped stack trace', async () => {
  // The most recent sentry email is the one the prior When/Then chain
  // pushed; assert the permalink shape covers the sourcemap surface.
  const sentryEmails = emailInbox.findAll((r) => r.vendor === 'sentry');
  expect(sentryEmails.length).toBeGreaterThan(0);
  const latest = sentryEmails[sentryEmails.length - 1];
  expect(latest.body).toMatch(/https:\/\/[^\s]*sentry\.io\/issues\/[^\s]+/);
  expect(latest.body).toContain('sourcemap=true');
});

// ────────────────────────────────────────────────────────────────────────────
// AC-2 — Request-completion logging reaches the operator sink.
// ────────────────────────────────────────────────────────────────────────────

Given('the Workers API is serving requests in staging', async () => {
  // See AC-1 note on staging-deploy preconditions. The acceptance tier
  // asserts the sink wiring and the redaction posture; the staging
  // deploy itself is owned by ADR-013.
});

When(
  'an end user submits a request that includes personal contact details in the payload',
  async () => {
    state.lastRequestId = await simulateRequestCompletionLogging();
  },
);

Then('the operator can find a single completion event for that request in the sink', async () => {
  expect(state.lastRequestId).toBeDefined();
  const events = logSink.findByRequestId(state.lastRequestId as string);
  expect(events.length).toBe(1);
});

Then('the operator does not see any personal contact details on that event', async () => {
  expect(state.lastRequestId).toBeDefined();
  const [event] = logSink.findByRequestId(state.lastRequestId as string);
  expect(event).toBeDefined();
  // Day 1 redaction posture: `bodyKeys` is the empty Set (ADR-012). The
  // acceptance scenario fails the moment a future ADR widens it without
  // a paired re-evaluation of the AC-2 scenario.
  expect(bodyKeysAllowlistSize()).toBe(0);
  // Belt and braces — assert the event does not carry the PII keys that
  // the simulated request payload contained. A regression in the redact
  // function would copy these into `event.fields` and trip the check.
  expect(Object.keys(event.fields)).not.toContain('email');
  expect(Object.keys(event.fields)).not.toContain('phone');
});

// ────────────────────────────────────────────────────────────────────────────
// AC-3 — Uptime probes (one scenario per target).
// ────────────────────────────────────────────────────────────────────────────

Given('the API health probe is configured against staging', async () => {
  assertProbeIsConfigured('API health');
});

Given('the web origin probe is configured against staging', async () => {
  assertProbeIsConfigured('web origin');
});

Given('the auth callback probe is configured against staging', async () => {
  assertProbeIsConfigured('auth callback');
});

When('the API health probe fails for long enough to trigger an alert', async () => {
  simulateProbeFailure('API health');
});

When('the web origin probe fails for long enough to trigger an alert', async () => {
  simulateProbeFailure('web origin');
});

When('the auth callback probe fails for long enough to trigger an alert', async () => {
  simulateProbeFailure('auth callback');
});

Then('the operator receives an alert email naming the API health probe', async () => {
  assertProbeAlertNames('API health');
});

Then('the operator receives an alert email naming the web origin probe', async () => {
  assertProbeAlertNames('web origin');
});

Then('the operator receives an alert email naming the auth callback probe', async () => {
  assertProbeAlertNames('auth callback');
});

function assertProbeAlertNames(probe: ProbeName): void {
  const matches = emailInbox.findAll(
    (r) => r.vendor === 'better-stack-uptime' && r.names.probe === probe,
  );
  expect(matches.length).toBeGreaterThan(0);
  expect(matches[0].subject).toContain(probe);
}

// ────────────────────────────────────────────────────────────────────────────
// AC-4 — Synthetic-failure rehearsal (switch on / switch off).
// ────────────────────────────────────────────────────────────────────────────

Given('the synthetic-failure rehearsal switch is on in staging', async () => {
  state.rehearsalFlag = 'true';
});

Given('the synthetic-failure rehearsal switch is off in staging', async () => {
  state.rehearsalFlag = undefined;
});

When('the operator fires the synthetic failure', async () => {
  simulateSyntheticFailure(state.rehearsalFlag);
});

When('the operator attempts to fire the synthetic failure', async () => {
  simulateSyntheticFailure(state.rehearsalFlag);
});

Then('the rehearsal surface is not exposed to the operator', async () => {
  expect(rehearsalSurfaceIsExposed(state.rehearsalFlag)).toBe(false);
});

Then('no alert email is delivered to the operator', async () => {
  expect(emailInbox.count()).toBe(0);
});

// ────────────────────────────────────────────────────────────────────────────
// AC-5 — Vendor cost ceiling overage.
// ────────────────────────────────────────────────────────────────────────────

Given(
  'an observability vendor has a documented monthly cost ceiling in the observability budget runbook',
  async () => {
    state.documentedVendor = assertAVendorIsDocumented();
  },
);

When("that vendor's monthly spend exceeds its documented ceiling", async () => {
  expect(state.documentedVendor).toBeDefined();
  simulateBudgetOverage(state.documentedVendor as string);
});

Then('the operator receives an alert email naming the offending vendor', async () => {
  expect(state.documentedVendor).toBeDefined();
  const matches = emailInbox.findAll(
    (r) => r.vendor === 'sentry-billing' && r.names.overspentVendor === state.documentedVendor,
  );
  expect(matches.length).toBeGreaterThan(0);
  expect(matches[0].subject).toContain(state.documentedVendor as string);
});

Then('the alert email references the observability budget runbook', async () => {
  const billingEmails = emailInbox.findAll((r) => r.vendor === 'sentry-billing');
  expect(billingEmails.length).toBeGreaterThan(0);
  const latest = billingEmails[billingEmails.length - 1];
  expect(latest.body).toContain('docs/ops/observability-budget.md');
});

// ────────────────────────────────────────────────────────────────────────────
// AC-6 — Fork pull-request CI safety.
// ────────────────────────────────────────────────────────────────────────────

Given('a contributor opens a pull request from a fork without Sentry credentials', async () => {
  state.forkPullRequestOpen = true;
});

When('the continuous integration build runs against that pull request', async () => {
  expect(state.forkPullRequestOpen).toBe(true);
  // Forks receive no org secrets — the SENTRY_AUTH_TOKEN env var arrives
  // empty at the composite-action boundary.
  state.sourcemapGuard = simulateSourcemapUploadGuard(undefined);
});

Then('the contributor sees the build pass', async () => {
  expect(state.sourcemapGuard).toBeDefined();
  const guard = state.sourcemapGuard as SourcemapGuardResult;
  expect(guard.exitCode).toBe(0);
  expect(guard.skipped).toBe(true);
});

Then(
  'the contributor sees a skip notice naming the sourcemap upload in the build log',
  async () => {
    expect(state.sourcemapGuard).toBeDefined();
    const guard = state.sourcemapGuard as SourcemapGuardResult;
    expect(guard.noticeLine.toLowerCase()).toContain('sourcemap upload');
  },
);

// ────────────────────────────────────────────────────────────────────────────
// AC-7 — Redaction allowlist discoverability.
// ────────────────────────────────────────────────────────────────────────────

Given('a maintainer is reading the observability redaction runbook', async () => {
  const runbookPath = path.join(REPO_ROOT, 'docs', 'ops', 'observability-redaction.md');
  // The Given step's contract is that the runbook is reachable. The
  // Then steps below read the references; failing the open here surfaces
  // a missing runbook before the assertion path.
  expect(fs.existsSync(runbookPath)).toBe(true);
});

Then('the maintainer sees a reference to the redaction allowlist module', async () => {
  const refs = readRedactionRunbookReferences();
  expect(refs.referencesAllowlistModule).toBe(true);
});

Then('the maintainer sees a reference to the redaction widening decision template', async () => {
  const refs = readRedactionRunbookReferences();
  expect(refs.referencesWideningTemplate).toBe(true);
});
