# Observability Redaction Allowlist

> **Status:** Authoritative trust boundary for log egress.
> **Module:** [`packages/shared/src/observability/redaction.ts`](../../packages/shared/src/observability/redaction.ts)
> **Tests:** [`packages/shared/src/observability/redaction.test.ts`](../../packages/shared/src/observability/redaction.test.ts) — `≥95%` branch coverage floor.
> **ADR:** [ADR-012 — Observability vendor stack](../decisions.md#adr-012--observability-vendor-stack-mvp-beta).
> **ADR-widening template:** [`docs/decisions/_template-redaction-widening.md`](../decisions/_template-redaction-widening.md).

## Why this document exists

The observability pipeline (Epic #5) ships one structured request-completion
event per Workers API request to a managed log sink. Everything that crosses
the wire passes through a **single module** —
[`redaction.ts`](../../packages/shared/src/observability/redaction.ts) — whose
exported `RedactionAllowlist` constant is the only place where PII disclosure
to logs is decided.

If you are reading this because you need a new field in the sink, the answer
is **not** "add it to the middleware metadata extractor." The answer is "open
a PR that instantiates the ADR template, expands the allowlist Set, and
extends the test suite." Tightening the allowlist is a one-line PR; loosening
it is a deliberate, reviewed decision.

## The allowlist (Day 1)

The constant lives in `redaction.ts` and is `Object.freeze`'d at module load.
At time of writing the allowlist is:

| Bucket       | Members |
| ------------ | ------- |
| `headers`    | `user-agent`, `cf-ray`, `cf-ipcountry`, `x-request-id`, `accept-language` |
| `queryKeys`  | `cursor`, `limit`, `order`, `sort` |
| `bodyKeys`   | _(empty Set — no JSON body fields are copied to logs)_ |

The `bodyKeys` Set starts empty deliberately. Most leakage incidents on
public observability stacks come from JSON bodies that were "obviously
safe" until they weren't. Day 1 posture: no body fields. Future widening
is gated by ADR.

### Why these headers

- `user-agent` — request shape, bot detection, no PII.
- `cf-ray` — Cloudflare request correlation ID; useful for cross-referencing
  Cloudflare's own logs with our sink.
- `cf-ipcountry` — country code only (ISO 3166-1 alpha-2); not an IP, not a
  city. Acceptable operational signal.
- `x-request-id` — caller-supplied correlation ID; if a client sends PII as
  the correlation ID that is the client's bug, not the sink's exposure.
- `accept-language` — surface used to reproduce locale-specific bugs.

### Why these query keys

`cursor`, `limit`, `order`, `sort` are the canonical pagination + sort
parameters across `/api/v1/**`. They are never set to user identifiers.
Filters that _would_ carry identifiers (e.g. `?email=...`) are out of scope
and are not added here.

## What the redaction module exports

The module exports three things:

1. `RedactionAllowlist` — the frozen `{ headers, queryKeys, bodyKeys }`
   object whose values are `Set<string>` instances. Anything else is
   ignored by the redact functions.
2. `redactHeaders(headers: Headers): Record<string, string>` — walks a
   `Headers` instance, lower-cases each name, and emits a flat string-to-string
   map containing **only** entries whose key is in `RedactionAllowlist.headers`.
3. `redactQueryAndBody(req: Request): Promise<Record<string, string>>` —
   parses the URL's `searchParams` and (when the `Content-Type` is JSON) the
   request body, and emits a flat string-to-string map of allowlisted entries.

Both redact functions are **pure with respect to their input**: they never
mutate the request, they never log, and they never throw on disallowed keys —
disallowed keys are silently dropped. That posture means a misconfigured caller
cannot smuggle PII by, e.g., capitalizing a header name or adding an unknown
JSON field.

## Widening the allowlist

**Adding a key to any Set requires an ADR.** The template is at
[`docs/decisions/_template-redaction-widening.md`](../decisions/_template-redaction-widening.md).
The ADR PR must:

1. Instantiate the template under `docs/decisions/ADR-NNN-<short-name>.md`.
2. Append the new key to the appropriate Set in `redaction.ts`.
3. Extend `redaction.test.ts` to cover the new key (both the positive copy
   path and the case-insensitive walk).
4. Update the table above in this document with the new member.

The ≥95% branch-coverage floor enforced by `vitest.config.ts` means a
widening PR that forgets to extend the test suite will fail CI before
review — that is intentional defense-in-depth.

## What this allowlist does NOT cover

- **Sentry breadcrumbs and stack traces.** Sentry has its own scrubbing
  (configured per-runtime in each `sentry.ts`); this allowlist governs the
  request-completion log sink only.
- **Raw request bodies for debugging.** The middleware never passes the raw
  body to Analytics Engine. Only the (currently empty) `bodyKeys` Set ever
  escapes.
- **Response bodies.** Out of scope — responses are not logged structurally.

## Related

- [ADR-012 — Observability vendor stack (MVP beta)](../decisions.md#adr-012--observability-vendor-stack-mvp-beta)
- [Tech Spec — Epic #5](https://github.com/dsj1984/athportal/issues/246)
- [PRD — Epic #5](https://github.com/dsj1984/athportal/issues/245)
- [`.agents/rules/security-baseline.md`](../../.agents/rules/security-baseline.md)
  — § Data Leakage & Logging
