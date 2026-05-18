/**
 * Uptime-probe alert-path helpers for Epic #5 AC-3.
 *
 * These functions read `infra/uptime/betterstack.yml` so the acceptance
 * scenario stays anchored in the IaC source of truth. A probe rename or
 * a removed monitor fails the scenario for the same reason it would
 * silence the real alert.
 *
 * Why simulate rather than drive Better Stack — see
 * `docs/decisions/0004-acceptance-email-capture.md`. The probe vendor
 * emails the operator from its own infrastructure; the acceptance tier
 * defends the wiring (the monitor exists, the alert destination is the
 * operator distribution list) and pushes one synthetic alert email per
 * failed-probe scenario.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emailInbox, type EmailRecord } from '../../fixtures/email-inbox';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

export type ProbeName = NonNullable<EmailRecord['names']['probe']>;

/**
 * Map a human-readable probe name (as it appears in scenario text) to
 * the `id:` field used in `infra/uptime/betterstack.yml`. The YAML ids
 * are kebab-case; scenario text uses the spaced phrasing.
 */
const PROBE_ID_BY_NAME: Record<ProbeName, string> = {
  'API health': 'api-health',
  'web origin': 'web-origin',
  'auth callback': 'auth-callback',
};

/**
 * Confirm the named probe is declared as a monitor in
 * `infra/uptime/betterstack.yml`. Throws when the monitor is missing so
 * the Given step fails on a removed/renamed probe instead of letting
 * the scenario continue with a synthetic email that no longer maps to
 * a real configuration.
 */
export function assertProbeIsConfigured(probe: ProbeName): void {
  const yamlPath = path.join(REPO_ROOT, 'infra', 'uptime', 'betterstack.yml');
  const source = fs.readFileSync(yamlPath, 'utf8');
  const expectedId = PROBE_ID_BY_NAME[probe];
  // The IaC layout pins one `- id: <slug>` per monitor; a literal
  // substring match is enough at this fidelity. A YAML structural change
  // would still trip the existing contract-tier IaC linter; this match
  // only guards against rename / removal.
  if (!new RegExp(`- id:\\s+${expectedId}\\b`).test(source)) {
    throw new Error(
      `Uptime monitor "${expectedId}" is not declared in ${yamlPath}. ` +
        'The Better Stack IaC has drifted from the AC-3 scenario set.',
    );
  }
  if (!source.includes('alert_destination: ${OBSERVABILITY_ALERT_EMAIL}')) {
    throw new Error(
      `Uptime monitors no longer route to OBSERVABILITY_ALERT_EMAIL in ${yamlPath}. ` +
        'The alert path the AC-3 scenarios assert on has changed.',
    );
  }
}

/**
 * Push a probe-failure alert email naming `probe` into the in-memory
 * inbox. Mirrors what Better Stack would emit when a monitor crosses
 * its `failure_threshold` (declared in the YAML as 2 consecutive cycles
 * per ADR 0003).
 */
export function simulateProbeFailure(probe: ProbeName): void {
  emailInbox.push({
    vendor: 'better-stack-uptime',
    subject: `[athportal] Probe failure: ${probe} probe`,
    body:
      `The ${probe} probe failed two consecutive cycles. ` +
      'Open the Better Stack monitor console to triage; the runbook ' +
      'at docs/ops/observability-runbook.md covers the procedure.',
    names: { probe },
  });
}
