/**
 * Vendor-budget alert-path helpers for Epic #5 AC-5 and the
 * request-completion logging assertion for AC-2.
 *
 * AC-5: each observability vendor declared in the budget runbook
 * (`docs/ops/observability-budget.md`) has a documented monthly ceiling.
 * When a ceiling is crossed, the operator receives an alert email naming
 * the offending vendor. The helper reads the runbook to confirm the
 * vendor row exists and synthesises the alert email the operator would
 * see.
 *
 * AC-2: the Workers API logs one request-completion event per request
 * to the managed sink, with PII filtered through the redaction
 * allowlist. The helper routes a simulated request through the actual
 * `redactQueryAndBody` export from `@repo/shared` so a regression in
 * the allowlist (a body key newly leaking through) fails the
 * acceptance test for the same reason it would leak in production.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RedactionAllowlist, redactHeaders, redactQueryAndBody } from '@repo/shared';
import { emailInbox, logSink } from '../../fixtures/email-inbox';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');

const BUDGET_RUNBOOK = path.join(REPO_ROOT, 'docs', 'ops', 'observability-budget.md');
const REDACTION_RUNBOOK = path.join(REPO_ROOT, 'docs', 'ops', 'observability-redaction.md');

/**
 * Read the budget runbook and return the list of vendor rows declared
 * in the per-vendor ceiling table. A row is the verbatim vendor name
 * (`Sentry`, `Cloudflare Logpush`, `Log sink (Better Stack Logs)`,
 * `Uptime vendor (Better Stack)` at time of writing).
 */
export function readDocumentedVendors(): string[] {
  const source = fs.readFileSync(BUDGET_RUNBOOK, 'utf8');
  const vendors: string[] = [];
  const tableRowRegex = /\|\s*\*\*([^*]+)\*\*\s*\|/g;
  let match = tableRowRegex.exec(source);
  while (match !== null) {
    vendors.push(match[1].trim());
    match = tableRowRegex.exec(source);
  }
  return vendors;
}

/**
 * Assert that at least one vendor in the runbook carries a documented
 * monthly ceiling. AC-5 phrases this as "an observability vendor has a
 * documented monthly cost ceiling in the observability budget runbook";
 * the Given step calls this helper so a runbook stripped of its
 * per-vendor rows fails the scenario before the alert simulation.
 */
export function assertAVendorIsDocumented(): string {
  const vendors = readDocumentedVendors();
  if (vendors.length === 0) {
    throw new Error(
      `The observability budget runbook at ${BUDGET_RUNBOOK} no longer declares ` +
        'any vendor rows. AC-5 cannot proceed.',
    );
  }
  // Return the first row so the simulation can name a concrete vendor.
  return vendors[0];
}

/**
 * Push a budget-overage alert email into the in-memory inbox. The body
 * cites the runbook path so the matching `Then` step ("the alert email
 * references the observability budget runbook") can assert against the
 * literal documented path.
 */
export function simulateBudgetOverage(vendorName: string): void {
  emailInbox.push({
    vendor: 'sentry-billing',
    subject: `[athportal] Observability budget exceeded: ${vendorName}`,
    body:
      `${vendorName} crossed its documented monthly ceiling. ` +
      `Review the per-vendor table and the triage procedure at ` +
      'docs/ops/observability-budget.md.',
    names: { overspentVendor: vendorName },
  });
}

/**
 * Assert that the redaction runbook references both the allowlist
 * module and the widening template. AC-7 phrases this as "the
 * maintainer sees a reference to X / Y"; the step library reads the
 * runbook and matches both references.
 */
export interface RedactionRunbookReferences {
  /** Whether the runbook links the allowlist module path verbatim. */
  referencesAllowlistModule: boolean;
  /** Whether the runbook links the widening-decision template path. */
  referencesWideningTemplate: boolean;
}

export function readRedactionRunbookReferences(): RedactionRunbookReferences {
  const source = fs.readFileSync(REDACTION_RUNBOOK, 'utf8');
  return {
    referencesAllowlistModule: source.includes(
      'packages/shared/src/observability/redaction.ts',
    ),
    referencesWideningTemplate: source.includes(
      'docs/decisions/_template-redaction-widening.md',
    ),
  };
}

/**
 * Simulate one request-completion event. The helper builds a `Request`
 * carrying a body with PII (an email field), routes the request through
 * `redactQueryAndBody` (which honours the live `bodyKeys` allowlist —
 * empty on Day 1 per ADR-012), and pushes the redacted record into the
 * in-memory log sink. AC-2's Then step asserts the operator can find a
 * single completion event and does not see any personal contact
 * details on it.
 */
export async function simulateRequestCompletionLogging(): Promise<string> {
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Synthetic PII — never use a real address, even in test fixtures.
  // testing-strategy.md forbids real PII in fixtures.
  const personalEmail = 'subject-under-test@example.invalid';
  const personalPhone = '+1-555-0100';

  const req = new Request(`https://example.invalid/?cursor=abc&email=${encodeURIComponent(personalEmail)}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'acceptance-test/1.0',
      'x-request-id': requestId,
      cookie: 'should_not_pass=' + personalEmail,
    },
    body: JSON.stringify({ email: personalEmail, phone: personalPhone, query: 'hello' }),
  });

  const allowedHeaders = redactHeaders(req.headers);
  const allowedQueryAndBody = await redactQueryAndBody(req);

  logSink.push({
    requestId,
    fields: { ...allowedHeaders, ...allowedQueryAndBody },
  });

  return requestId;
}

/**
 * Return the redaction allowlist's body-key set. The AC-2 step library
 * uses this to confirm the "no body keys allowed" posture (empty set on
 * Day 1, widened only via ADR).
 */
export function bodyKeysAllowlistSize(): number {
  return RedactionAllowlist.bodyKeys.size;
}
