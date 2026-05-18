# ADR-NNN — Widen the observability redaction allowlist: `<short-name>`

> **Template.** Copy this file to `docs/decisions/ADR-NNN-<short-name>.md`,
> replace every `<…>` placeholder, and submit alongside the source change
> that extends [`packages/shared/src/observability/redaction.ts`](../../packages/shared/src/observability/redaction.ts)
> and its sibling test file. Do not edit this template in place — it is the
> shape every widening PR must instantiate.
>
> The companion operator-facing document is
> [`docs/ops/observability-redaction.md`](../ops/observability-redaction.md).

**Status:** Proposed | Accepted | Superseded by ADR-XXX

**Date:** YYYY-MM-DD

**Epic / Story:** #NNNN

## Context

What problem is this widening solving? Name:

- The concrete field name(s) being added, in which bucket
  (`headers`, `queryKeys`, or `bodyKeys`).
- The user-visible or operator-visible need that cannot be met today
  (e.g. "we cannot bisect 5xx spikes by tenant without `x-tenant-id`").
- The data-classification of the field (operational metadata, business
  identifier, content). PII or pseudo-PII additions require explicit
  justification under "Privacy posture" below.
- Whether the field is already in scope of an existing Sentry scrubber,
  CDN log line, or other downstream pipeline — and whether widening here
  duplicates that surface.

## Decision

State the change exactly:

```ts
// In packages/shared/src/observability/redaction.ts
export const RedactionAllowlist = Object.freeze({
  headers: new Set([
    // existing entries…
    '<new-header-name>',
  ] as const),
  // …
});
```

Include the matching test addition in `redaction.test.ts` (positive copy
path + case-insensitive walk + rejection of any neighbouring key that is
*not* being widened).

## Consequences

- **Downstream visibility.** What dashboards, alerts, or runbooks can now
  use the new field?
- **PII exposure delta.** What was not in the sink before and is in the
  sink now? Be explicit even when the answer is "nothing PII-class" — the
  audit trail is the point of the ADR.
- **Coverage floor.** Confirm the ≥95% branch-coverage gate still passes
  with the new tests in place.
- **Sink quotas.** Does the new field materially increase event payload
  size or per-month sink ingest? If so, name the budget impact.

## Privacy posture

Answer all four:

1. **Is this field a direct PII identifier** (email, phone, full IP, full
   name, government ID)? If yes, the widening is presumptively rejected —
   route the discussion to the security baseline and a CMK-encryption
   Epic before re-opening the ADR.
2. **Is this field a pseudo-PII identifier** (account ID, session ID, IP
   prefix, tenant slug)? If yes, name the risk-acceptance argument: who
   in the sink can see it, what retention applies, what compliance regime
   covers it.
3. **Is this field a free-text user input** (a search query, a comment
   excerpt, a filename)? If yes, the widening is presumptively rejected.
   Free-text fields cannot be reliably bounded to non-PII contents.
4. **Does Sentry already scrub this field?** If yes, document the asymmetry
   — the request-completion sink is a separate egress path with separate
   retention; absence in Sentry does not imply absence here.

## Rollback

How is this widening removed if the privacy posture turns out to be wrong?

- The source revert is a one-line PR: remove the entry from the Set in
  `redaction.ts` and re-tighten the test file.
- Already-emitted events in the sink are out of scope for the source
  revert. If the field needs to be purged from the sink, name the vendor's
  bulk-delete or retention-pinning procedure here.
- Supersede this ADR with a new ADR that documents the revert rationale.
