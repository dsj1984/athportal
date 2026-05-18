/**
 * Public surface of `@repo/shared`.
 *
 * Re-exports the observability primitives landed in Epic #5 (Story #256)
 * so consumers can write `import { LogEventSchema } from '@repo/shared'`
 * without reaching into subpaths.
 */
export { LogEventSchema, type LogEvent } from './observability/log-event';
export {
  RedactionAllowlist,
  redactHeaders,
  redactQueryAndBody,
} from './observability/redaction';
