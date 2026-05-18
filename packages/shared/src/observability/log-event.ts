/**
 * `LogEvent` — the structured request-completion event written to
 * Cloudflare Workers Analytics Engine and forwarded to the managed log
 * sink via Logpush.
 *
 * Defined in Epic #5 Tech Spec (#246) § Data Models. The schema is the
 * contract between the `requestLogger` middleware (which constructs the
 * event) and the redaction module (which decides which metadata keys
 * may appear on the wire). It is exported from `@repo/shared` so the
 * API runtime, future workers, and contract tests can all import the
 * same definition.
 *
 * Envelope rules:
 *   - `ts`, `runtime`, `env`, `release`, `method`, `route_pattern`,
 *     `status`, `duration_ms` are required for every request.
 *   - `error_class` is present iff the handler threw or returned >= 500.
 *   - `metadata` is a string-keyed string map containing ONLY keys
 *     that pass the allowlist in `redaction.ts`. The schema does not
 *     re-enforce the allowlist; that is the redaction module's job.
 *     The schema's role here is shape: every metadata value is a
 *     stringified scalar so the sink's column model stays flat.
 */
import { z } from 'zod';

export const LogEventSchema = z.object({
  // Required envelope — always present, never PII.
  ts: z.string().datetime({ offset: true }),
  runtime: z.enum(['workers', 'astro', 'expo']),
  env: z.enum(['development', 'staging', 'production']),
  release: z.string().min(1),

  // Request shape — always present for Workers requests.
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
  route_pattern: z.string().min(1),
  status: z.number().int().min(100).max(599),
  duration_ms: z.number().int().nonnegative(),

  // Error envelope — present iff status >= 500 or handler threw.
  error_class: z.string().min(1).optional(),

  // Allowlisted metadata — populated by the redaction module. The
  // schema only enforces the flat string-to-string shape; the redaction
  // module enforces which keys may appear.
  metadata: z.record(z.string(), z.string()).default({}),
});

export type LogEvent = z.infer<typeof LogEventSchema>;
