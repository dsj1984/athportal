/**
 * In-memory email-inbox + log-sink fixtures for the Epic #5 observability
 * acceptance scenarios.
 *
 * Why in-memory rather than a real SMTP catcher (Mailpit) — see
 * `docs/decisions/0004-acceptance-email-capture.md`. The short version: the
 * vendor emails the acceptance tier asserts on originate from SaaS
 * (Sentry / Better Stack); a local SMTP catcher does not raise the fidelity
 * floor and would force step bodies into the `/api/` URL literal that the
 * step-definition linter forbids.
 *
 * Both surfaces — `emailInbox` and `logSink` — are module-scope singletons.
 * The step library calls `resetObservabilityState()` in a `before` hook so
 * state never leaks between scenarios.
 */

export type EmailVendor = 'sentry' | 'better-stack-uptime' | 'better-stack-logs' | 'sentry-billing';

export interface EmailRecord {
  /** The vendor that synthesised the alert. */
  vendor: EmailVendor;
  /** Subject line as the operator would see it in their inbox. */
  subject: string;
  /** Body text. Helpers synthesise a permalink / runbook reference here. */
  body: string;
  /**
   * Per-vendor metadata the helpers attach so steps can assert "names the
   * Workers runtime" / "names the API health probe" without parsing the
   * subject string. Each runtime/probe/vendor name appears verbatim in the
   * subject as well — matched by both the metadata and the subject for
   * defence in depth.
   */
  names: {
    /** The runtime that raised the alert. Set for Sentry alerts. */
    runtime?: 'Workers' | 'Astro' | 'Expo';
    /** The probe that failed. Set for uptime alerts. */
    probe?: 'API health' | 'web origin' | 'auth callback';
    /** The vendor whose budget ceiling was crossed. Set for budget alerts. */
    overspentVendor?: string;
  };
}

export interface LogSinkRecord {
  /**
   * A correlation key the operator would use to find the event. The helper
   * synthesises a stable token per simulated request; the steps look it up
   * by token rather than mutating any global state.
   */
  requestId: string;
  /**
   * Allowlisted fields that survived the redaction boundary. The helper
   * routes the simulated request through the actual `redactHeaders` /
   * `redactQueryAndBody` exports from
   * `packages/shared/src/observability/redaction.ts`, so a regression in
   * the allowlist (a body key newly leaking through) fails this assertion
   * for the same reason it would leak in production.
   */
  fields: Record<string, string>;
}

class InMemoryInbox {
  private records: EmailRecord[] = [];

  push(record: EmailRecord): void {
    this.records.push(record);
  }

  findAll(predicate: (r: EmailRecord) => boolean): EmailRecord[] {
    return this.records.filter(predicate);
  }

  count(): number {
    return this.records.length;
  }

  reset(): void {
    this.records = [];
  }
}

class InMemoryLogSink {
  private records: LogSinkRecord[] = [];

  push(record: LogSinkRecord): void {
    this.records.push(record);
  }

  findByRequestId(requestId: string): LogSinkRecord[] {
    return this.records.filter((r) => r.requestId === requestId);
  }

  reset(): void {
    this.records = [];
  }
}

export const emailInbox = new InMemoryInbox();
export const logSink = new InMemoryLogSink();

/**
 * Reset every observability fixture surface. Steps call this in a `Before`
 * hook so scenarios start from a clean inbox + sink and so a previous
 * scenario's `no alert email is delivered` assertion is not polluted by a
 * leftover record.
 */
export function resetObservabilityState(): void {
  emailInbox.reset();
  logSink.reset();
}
