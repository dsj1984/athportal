# Observability Budget — Per-Vendor Cost Ceilings

> **Status:** Authoritative per-vendor cost-ceiling and budget-alert record for
> the observability vendor stack (Epic #5).
> **ADRs:**
> [ADR-012 — Observability vendor stack](../decisions.md#adr-012--observability-vendor-stack-mvp-beta)
> ($50/month combined ceiling, two-consecutive-months policy),
> [ADR 0001 — Sentry organization and region](../decisions/0001-sentry-org-and-region.md),
> [ADR 0002 — Log-sink vendor selection](../decisions/0002-log-sink-vendor.md),
> [ADR 0003 — Uptime probe vendor selection](../decisions/0003-uptime-vendor.md).
> **Tech Spec:** [#246](https://github.com/dsj1984/athportal/issues/246).
> **Companion docs:**
> [`observability-runbook.md`](./observability-runbook.md) (alert triage),
> [`observability-redaction.md`](./observability-redaction.md) (PII trust
> boundary).

## Purpose

This document is the single page an operator reads to answer three questions:

1. **What is the documented monthly spend ceiling for each observability
   vendor**, and where does it come from?
2. **Which vendor-native alert is configured to fire before each ceiling is
   crossed**, and what does it route to?
3. **What does the operator do when one of those alerts lands in the inbox?**

The combined Epic-level ceiling is **$50/month** per ADR-012. The per-vendor
ceilings below sum to a budgeted $84/month and are individually enforced —
ADR-012's $50 line is a renegotiate/downsize trigger, not a hard cap (see
the ADR for the two-consecutive-months policy). When one vendor's ceiling
is approached, the operator is expected to act on that vendor's native
alert first; the Epic-level overage is the second-order signal.

## The canonical alert channel

Every vendor-native budget alert documented here routes into the **single
operator-email distribution list of record** named in ADR-012 §
"Alerting channel". The distribution list address is provisioned per
environment and stored in the `OBSERVABILITY_ALERT_EMAIL` GitHub Actions /
Cloudflare Workers secret. There is no parallel paging path (SMS,
Pushover, PagerDuty) at the MVP beta — the email channel is the single
fail-safe.

The same channel carries error-rate, uptime, and log-anomaly alerts, so
the inbox already follows the acknowledge-by-reply-all contract in
[`observability-runbook.md` § Receiving an alert](./observability-runbook.md#receiving-an-alert).
Budget alerts follow the same contract.

## Per-vendor monthly cost ceilings

| Vendor | Service | Monthly Ceiling (USD) | Native Alert Mechanism |
| --- | --- | --- | --- |
| **Sentry** | Error-tracking event quota across `workers` / `web` / `mobile` projects (ADR 0001) | **$26 / month** (Team plan, single seat; covers the MVP error-event volume with headroom) | Sentry org **Spend cap** in the billing settings panel, capped at the documented ceiling. When the cap is hit, Sentry stops accepting new events for the remainder of the billing cycle and emails the org owner. The org-owner address is `OBSERVABILITY_ALERT_EMAIL`. |
| **Cloudflare Logpush** | Logpush egress job on `apps/api` (the job declared in `apps/api/wrangler.toml`) | **No standalone spend ceiling** — Logpush itself is included in the Workers Paid plan; the egress destination's ingest cost is governed by the log-sink row below | Logpush job health is surfaced via the Cloudflare console; failures route through the runbook's `[Cloudflare]` triage path. There is no Cloudflare-native dollar alert on Logpush because the dollar exposure is at the sink. |
| **Log sink (Better Stack Logs)** | Managed sink receiving the Logpush stream (ADR 0002) | **$30 / month** ($25/month Team plan seat + $5 headroom for a single-month traffic spike crossing 1 GB/day ingest) | Better Stack Logs **anomaly rule** on monthly ingest volume, threshold set at the documented ceiling, routed into `OBSERVABILITY_ALERT_EMAIL`. The rule fires when projected month-end ingest crosses the $30/month line based on the running daily rate. |
| **Uptime vendor (Better Stack)** | External uptime probes from ≥2 regions on `/health`, `/`, `/auth/callback` (ADR 0003) | **$29 / month** (Team plan seat — required for the 60-second probe cadence Tech Spec #246 pins) | Better Stack **seat-count alert** in the team settings panel, threshold set at 1 (single-operator MVP). When a second seat is provisioned, the alert fires into `OBSERVABILITY_ALERT_EMAIL` so the seat-cost upgrade is caught before the next billing cycle rather than via a billing surprise. |

The four rows above are the complete observability vendor surface for
Epic #5. Any new observability vendor added in a follow-on Epic MUST add a
row here in the same Story that wires the vendor in.

## When an alert fires — triage procedure

A vendor-native budget alert is not an incident in the same sense as an
error-rate spike or a probe failure — the system is still serving traffic.
It is a **spend signal** that requires the operator to decide between (a)
absorbing a one-time overage, (b) tuning the source of the cost growth,
or (c) initiating the renegotiate/downsize cycle ADR-012 names.

Procedure:

1. **Acknowledge by replying-all to the distribution list.** A single
   line (`"Triaging budget alert — <your name>"`) is enough. Same
   contract as every other alert; see the runbook.
2. **Identify the vendor from the alert subject.** Each row in the table
   above describes the native alert's wording and source so the
   subject-prefix-to-vendor mapping is unambiguous.
3. **Open the vendor console and confirm the alert is real.** Console
   URLs are in [`observability-runbook.md` § Vendor consoles](./observability-runbook.md#vendor-consoles).
4. **Establish the cause class.**
   - **Sentry — spend cap hit.** Either real error-volume growth (open
     the issues panel; the runbook's Sentry triage section applies) or a
     misconfigured `tracesSampleRate` flooding the quota (check the
     latest release's runtime config).
   - **Log sink — ingest anomaly.** Either real traffic growth (the
     redacted log line count rose) or a regression that started emitting
     unexpectedly large payloads (check
     [`observability-redaction.md`](./observability-redaction.md) for the
     allowlist; an over-broad addition can balloon row size).
   - **Uptime — seat-count alert.** A second seat was provisioned —
     either intentionally (a new on-call rotates in; update the
     distribution list instead) or accidentally (a teammate signed up
     under the team account; remove the seat).
5. **Decide the response.**
   - **One-time overage with a known cause and a planned fix:** absorb
     it, file a follow-on Task to land the fix, and note the absorption
     in the operator-email thread.
   - **Sustained growth that crosses the ceiling for a second consecutive
     month:** trigger the renegotiate/downsize cycle named in ADR-012.
     For Sentry, that is the spend-cap rationalization; for the log sink,
     it is the substitute-vendor swap in ADR 0002 § "Rollback"; for
     uptime, it is the substitute-vendor swap in ADR 0003 § "Rollback".
   - **Unknown cause:** do not raise the ceiling without diagnosis.
     Raising the spend cap to silence the alert is the failure mode this
     document exists to prevent.
6. **Record the decision on this page.** When a ceiling is changed (up
   or down), update the row above in the same PR that changes the vendor
   console, and link the PR from the operator-email acknowledgement
   thread so the audit trail is one click away.

## Vendor-native alert configuration record

The three vendor-native alerts in the table above are SaaS console
actions — there is no API surface in this repo to assert against, so the
configuration evidence is captured here as a timestamp record alongside
the runbook's screenshot path. Each row below is appended by the
operator-confirmed Story #285 task that activates the alert.

| Vendor | Alert | Configured on (UTC) | Confirmed by | Runbook screenshot |
| --- | --- | --- | --- | --- |
| **Sentry** | Org spend cap at $26/month | _pending — appended by Task #298_ | _pending_ | _pending_ |
| **Log sink (Better Stack Logs)** | Monthly-ingest anomaly rule at $30/month | **2026-05-17 23:14 UTC** | Operator (`OBSERVABILITY_ALERT_EMAIL` distribution list) | Captured in the Better Stack Logs anomaly-rule console; screenshot path to be linked from the operations runbook in a follow-on update. |
| **Uptime (Better Stack)** | Seat-count alert at 1 seat | _pending — appended by Task #299_ | _pending_ | _pending_ |

The screenshot column links into the operations runbook's vendor-console
screenshot directory once captured; until then, the operator-confirmed
timestamp is the audit record.
