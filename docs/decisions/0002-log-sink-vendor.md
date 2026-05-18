# 0002 — Managed log-sink vendor selection (Better Stack Logs default)

**Status**: Accepted

**Date**: 2026-05-17

**Supersedes**: none

**Related**: [`docs/decisions.md` § ADR-012 — Observability vendor stack (MVP beta)](../decisions.md#adr-012--observability-vendor-stack-mvp-beta), [`docs/decisions/0003-uptime-vendor.md`](./0003-uptime-vendor.md)

---

## Context

ADR-012 ratified Cloudflare Workers Analytics Engine + Logpush as the
structured-log surface for `apps/api`: the request-completion middleware
at `apps/api/src/middleware/request-logger.ts` (Story #257) writes one
row per request into the `athportal_request_log` dataset, and a
Cloudflare Logpush job (Story #272, this Epic) ships those rows to a
**managed log sink** for retention, search, and dashboarding. ADR-012
did **not** pin which managed sink — the choice was deliberately deferred
to a per-vendor evaluation so the cost-per-GB and data-residency posture
of each candidate could be compared against real Cloudflare Logpush
destination-compatibility before being locked into wrangler.toml.

This ADR records that evaluation. The constraints inherited from
ADR-012 § "Observability vendor stack" are:

- **Cost ceiling: $50/month for the whole Epic** (Sentry + Logpush +
  Better Stack uptime combined). The log sink's share must fit within
  the headroom the other two vendors leave — call it ~$30/month upper
  bound for the sink alone at MVP-beta volume.
- **Migration cost: bounded at one Story per vendor.** No vendor
  lock-in beyond a single config surface (here, the `[[logpush]]` block
  in `apps/api/wrangler.toml` plus the deploy-step env-var rendering).
- **EU data-residency posture** to mirror ADR-0001's Sentry EU region
  (Frankfurt). Athlete-portal PII is post-redaction at the edge per the
  shared `RedactionAllowlist` (Story #256), but the residency of the
  sink that retains the post-redaction payloads is still load-bearing
  for GDPR coverage.
- **Cloudflare Logpush destination compatibility.** The vendor MUST be
  a first-class Logpush destination so the deploy step renders a single
  HTTPS URL with a bearer token in the `Authorization` header and the
  Cloudflare-side job streams NDJSON straight in. Vendors that require
  a custom forwarder (a Worker, a Lambda, a relay) inflate the
  migration cost and add a second failure surface.
- **Alerting integration with the single operator-email channel of
  record** named in ADR-012 § "Alerting channel". The sink does not need
  to be the alert origin (Better Stack uptime + Sentry already cover
  that), but it must support anomaly rules that route into
  `OBSERVABILITY_ALERT_EMAIL` so log-side anomalies (error-rate spikes,
  PII-redaction-failure markers) can page without a separate paging
  vendor.

## Vendors evaluated

The three vendors named in ADR-012 § "structured-log + dashboard
surface" were evaluated against the constraints above. Pricing is the
per-GB ingest rate published on each vendor's public pricing page as of
**2026-05-17** (the authoring date — re-validate when this ADR is
revisited, since vendor pricing drift is the most likely trigger for a
substitution).

| Vendor | Per-GB ingest (2026-05-17) | EU region | Logpush destination | Free tier covering MVP | Monthly ceiling at MVP volume |
| --- | --- | --- | --- | --- | --- |
| **Better Stack Logs** | $0.25 / GB after free tier | EU (Frankfurt) available | First-class HTTPS bearer-token destination | 1 GB/day, 3-day retention free | **$25/month** (Team plan, 30-day retention, single seat) |
| Datadog Logs | $0.10 / GB ingest + $1.70 / million events indexed | EU (Frankfurt) available | First-class Logpush destination | 5 GB/day, 15-day retention free trial only | $50–80/month at MVP volume (index spend dominates) |
| Axiom | $0.25 / GB after free tier | US-East default; EU on Enterprise tier only | First-class HTTPS destination | 500 GB/month ingest free | **$0/month at MVP volume** but EU posture requires Enterprise tier (custom pricing, no public page) |

**MVP volume estimate.** The request-completion middleware emits one
LogEvent per request. At MVP beta volume — back-of-envelope ~100k
requests/day from a few hundred athletes and coaches — each event
serializes to roughly 1.5 KB after redaction (headers + redacted query
plus a handful of metadata fields). 100k events × 1.5 KB = 150 MB/day,
~4.5 GB/month. The Team-plan ceiling above carries 30-day retention
headroom for a single-month traffic spike up to ~10× the estimate
before crossing $30/month.

## Decision

- **Adopt Better Stack Logs as the managed log-sink vendor.** The
  Logpush job declared in `apps/api/wrangler.toml` targets the
  `athportal_request_log` Analytics Engine dataset and ships NDJSON to
  Better Stack Logs via the env-rendered destination URL. The
  Workers-side and CI-side credential is the `LOGPUSH_SINK_TOKEN`
  bearer token declared in `.env.example` and documented in the
  [README env table](../../README.md#environment-variables).
- **Plan: Better Stack Logs free tier (MVP).** The free tier (1 GB/day,
  3-day retention) covers the MVP-beta volume estimate above with
  ~10× headroom on daily ingest and exceeds the contract Tech Spec #246
  pins for "structured logs with edge-side PII redaction".
- **Upgrade trigger: 30-day retention requirement before production
  launch.** The Team plan ($25/month seat) lifts the retention floor
  from 3 days to 30 days, which is the floor an on-call rotation needs
  for week-old-incident root-cause analysis. The upgrade is a single
  Epic-close checklist item — same pattern as ADR-0003's Better Stack
  uptime plan upgrade.
- **Documented monthly ceiling: $30/month for the log sink alone.**
  $25/month for the Team-plan seat plus a $5 headroom for a single-month
  traffic spike crossing 1 GB/day ingest. Combined with the $29/month
  Better Stack uptime Team-plan seat (ADR-0003) and the Sentry free tier
  (ADR-0001), the total observability spend lands at $54/month — $4
  over ADR-012's $50/month ceiling. The overage is bounded to a single
  vendor seat and reviewed at Epic close per ADR-012's
  "two consecutive months over triggers a renegotiate/downsize" clause.
- **EU data-residency.** The Better Stack Logs source is created in the
  Frankfurt (EU) region, mirroring ADR-0001's Sentry EU posture. No
  athlete-portal PII leaves the EU after redaction at the Workers edge.

## Why not Datadog Logs

Datadog Logs is a first-class Cloudflare Logpush destination and offers
the lowest published ingest rate ($0.10/GB), but its **per-million-event
indexing surcharge** ($1.70 per million events indexed) inverts the
economics at this scale: 100k events/day × 30 days = 3M events/month at
$5.10/month for indexing alone, on top of the $0.45/month ingest. The
two together still fit the headroom, but Datadog's free trial expires
after 14 days — there is no permanent free tier. Once the trial ends,
the minimum spend lands around $50–80/month for a single seat with the
APM module disabled, which exceeds the $30/month ceiling for the sink
alone.

Datadog also lacks a granular "logs-only" billing posture; the seat
implies the full Datadog observability suite, which inflates the
migration cost when the vendor's value-add (the APM/RUM surface) is
explicitly out of scope for this Epic.

## Why not Axiom

Axiom is the most cost-attractive option on paper — 500 GB/month free
ingest at the published pricing tier covers MVP-beta volume with
**three orders of magnitude** of headroom. Two constraints push it out
of the running:

- **EU data-residency is gated to the Enterprise tier.** The free and
  Pro tiers default to US-East with no region selector; the Enterprise
  tier (custom pricing, no public page) is the only path to a Frankfurt
  region. Custom pricing means the cost ceiling cannot be modeled at
  this ADR's authoring date — the upgrade path is opaque.
- **Anomaly-rule alerting requires per-rule paid integrations.** Axiom's
  free-tier alert routing covers email to a single inbox, but the
  threshold-based rule engine the log-side anomaly detection would need
  (PII-redaction-failure markers, error-rate spikes) is a paid add-on
  outside the free tier.

If Better Stack Logs changes shape post-launch (free-tier ingest cap
drops, Team-plan seat price rises beyond the $30 ceiling, or the
Frankfurt region degrades), Axiom is the **substitute of record** for
US-residency workloads. The EU-residency constraint is the load-bearing
gate for the default choice today.

## Rollback

If Better Stack Logs free-or-Team tier changes shape (ingest cap drops
below MVP volume, retention floor rises beyond 30 days, or a
billing-surprise upgrade is forced), the rollback is bounded to one
Story per ADR-012's "no vendor lock-in beyond the SDK surface":

1. Provision an account with the highest-priority substitute (Datadog
   Logs for EU residency at scale, Axiom for cost-attractive
   US-residency workloads).
2. Update the deploy step at `.github/workflows/deploy-staging.yml`
   and `.github/workflows/deploy-production.yml` to render
   `LOGPUSH_DESTINATION_URL` against the substitute vendor's HTTPS
   endpoint and bearer-token shape.
3. Rotate `LOGPUSH_SINK_TOKEN` in GitHub Actions secrets and
   Cloudflare Workers secrets (`wrangler secret put` per environment).
4. Re-deploy each environment; the `[[logpush]]` block in
   `apps/api/wrangler.toml` does **not** change because the destination
   URL is sourced from env, not hardcoded.
5. Supersede this ADR with one recording the switch rationale and the
   updated cost ceiling.

No application code, no test-suite change, no schema migration. The
vendor-coupling surface is the env-var rendering at deploy time plus
this ADR.

## Consequences

- **The `[[logpush]]` block in `apps/api/wrangler.toml` is the entire
  vendor-coupled config surface.** Vendor swaps update the
  `LOGPUSH_DESTINATION_URL` env rendering in CI plus this ADR; the
  wrangler.toml file is untouched.
- **The $30/month log-sink ceiling is a policy floor.** Approaching the
  ceiling triggers the renegotiate/downsize cycle named in ADR-012
  (two consecutive months over → re-evaluate the vendor or downgrade
  retention).
- **EU data-residency is structural, not aspirational.** A future change
  that moves the sink to a US-region source MUST trigger a new ADR
  superseding this one — the residency rationale is load-bearing for
  the GDPR posture, not an in-PR review topic.
- **The redaction-at-edge boundary remains the trust gate.** The
  managed sink ingests post-redaction payloads only; the shared
  `RedactionAllowlist` at `packages/shared/src/observability/redaction.ts`
  (Story #256) is the authoritative source of truth for what leaves
  the Worker. The sink is **not** allowed to be the redaction surface.

## Cross-references

- ADR-012 — Observability vendor stack (MVP beta): names Analytics
  Engine + Logpush as the log surface; this ADR pins which managed
  sink.
- [`docs/decisions/0001-sentry-org-and-region.md`](./0001-sentry-org-and-region.md):
  established the Frankfurt EU region precedent this ADR mirrors.
- [`docs/decisions/0003-uptime-vendor.md`](./0003-uptime-vendor.md):
  parallel single-vendor selection ADR for the uptime probe — same
  pattern (default + substitute set + rollback).
- Tech Spec #246 § "Structured logs": pins the request-completion
  middleware's egress contract and the dataset name.
- PRD #245: the parent Epic's product requirements for observability.
- `apps/api/wrangler.toml`: the `[[logpush]]` block that consumes
  `LOGPUSH_DESTINATION_URL`.
- `.env.example` and [README § Environment variables](../../README.md#environment-variables):
  the env-contract entry for `LOGPUSH_SINK_TOKEN`.
