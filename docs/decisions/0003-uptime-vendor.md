# ADR 0003 — Uptime probe vendor selection (Better Stack default)

**Status**: Accepted (2026-05-17, Epic #5 — Story #254)

**Supersedes / refines**: ADR-012 (Observability vendor stack — MVP beta) §
"Better Stack is the external uptime-probe vendor." ADR-012 named Better
Stack as the default; this ADR records the per-vendor evaluation that
backs that default, the substitute set, the explicit
independence-from-Cloudflare rationale, and the seat-cost / probe-frequency
floor the chosen plan must clear.

---

## Context

The Athlete Portal stack runs on Cloudflare end-to-end: the API workspace
(`apps/api`) ships as a Cloudflare Worker, the web workspace (`apps/web`)
ships as a Cloudflare-fronted Astro deploy, and authentication callbacks
land on the same Worker fleet. Cloudflare's own status page covers
control-plane health, but a regional Cloudflare incident — or a config
misstep that black-holes traffic to our specific Workers project — is
exactly the failure mode an uptime probe is meant to catch. **A probe
hosted on the same infrastructure as the target can be silenced by the
same outage it is meant to alert on.** Story #254's parent Feature #253
calls out this constraint explicitly: probes MUST run from a vendor that
is operationally independent of Cloudflare.

The Tech Spec at #246 § "Uptime probes" pins three target URLs (API
`/health`, web origin `/`, and `/auth/callback`), each probed every 60
seconds from at least two distinct geographic regions, with alerts firing
only after **two** consecutive failures (single-region transient flaps
must not page). The vendor must therefore provide:

- Probes that originate from an infrastructure provider distinct from
  Cloudflare (no Workers-hosted, no R2-fronted probe runners).
- At least two geographic regions per monitor, declarable in IaC.
- Configurable consecutive-failure thresholds (≥ 2).
- Native email alerting into the single operator-email channel of record
  named in ADR-012.
- Free or near-free tier that fits within the $50/month Epic-level cost
  ceiling without eating the entire budget.

ADR-012 named **Better Stack** as the default and **Pingdom or
Uptime.com** as acceptable substitutes. This ADR captures the per-vendor
comparison that backed that default, so the substitute path is
unambiguous if Better Stack's free tier changes shape or a regional
restriction surfaces post-launch.

## Decision

- **Adopt Better Stack as the primary uptime-probe vendor.** Probe
  configuration is encoded in IaC at
  [`infra/uptime/betterstack.yml`](../../infra/uptime/betterstack.yml).
  Three monitors target the URLs named in Tech Spec #246 § "Uptime
  probes", each probed from at least two distinct geographic regions
  (`us-east-1` and `eu-west-1` at minimum) every 60 seconds, with alerts
  firing after two consecutive failures into the
  `OBSERVABILITY_ALERT_EMAIL` destination.

- **Better Stack runs on infrastructure independent of Cloudflare.**
  Better Stack's probe network is hosted on a multi-region footprint
  spanning AWS, Hetzner, and Google Cloud (per Better Stack's public
  probe-location list at <https://betterstack.com/docs/uptime/probes/>).
  No probe runner is hosted on Cloudflare Workers, R2, or any other
  Cloudflare-fronted surface, satisfying the
  independence-from-Cloudflare requirement.

- **Plan: Better Stack free tier (MVP).** The free tier covers ten
  monitors with a minimum probe interval of three minutes, which exceeds
  this Story's three-monitor scope. Tech Spec #246 § "Uptime probes"
  pins probe frequency at **60 seconds**, which requires upgrading to
  the **Better Stack Team plan ($29/month seat)** before production
  launch. The seat-cost / probe-frequency line is captured here so the
  Epic-close audit catches the plan upgrade rather than discovering it
  via a billing surprise.

- **Substitute set, in priority order**:
  1. **Pingdom** — long-running incumbent, similar IaC story via the
     Terraform `pingdom_check` resource. Trade-off: more expensive seat
     ($15/month per check at the lowest tier), no free tier for new
     accounts as of 2026.
  2. **Uptime.com** — comparable feature set, $20/month for 10
     monitors, dedicated REST API for declarative config. Trade-off:
     smaller probe-location footprint than Better Stack or Pingdom.

  Switching vendors is **bounded at one Story** by ADR-012's "no vendor
  lock-in beyond the SDK surface" clause. The IaC file at
  `infra/uptime/betterstack.yml` is the entire vendor-coupled surface;
  swapping to Pingdom or Uptime.com replaces this one file plus the
  apply runbook at `infra/uptime/README.md`.

- **Alerting destination is the single operator email.** Both Better
  Stack's failure-rule webhook and Sentry's alert rules route to
  `${OBSERVABILITY_ALERT_EMAIL}` (the single channel of record named in
  ADR-012 § "Alerting channel"). No parallel paging path (SMS, Pushover,
  PagerDuty) is provisioned for the beta — the email channel is the
  single fail-safe.

- **Two-consecutive-failure threshold is mandatory.** Single-region
  transient flaps (DNS resolution hiccups, NAT-gateway connection
  resets, vendor-side probe-runner restarts) MUST NOT page. The IaC file
  carries `failure_threshold: 2` on every monitor; CI grep gates
  enforce that the threshold is never dropped by an accidental edit.

## Why not Cloudflare-native probes

Cloudflare offers a Health Checks product (formerly Argo Health Checks)
that probes origins from Cloudflare's network. It was rejected explicitly
for the independence requirement:

- A Cloudflare control-plane outage takes down the Health Checks UI and
  the alert dispatch path simultaneously. The 2022-06-21 Cloudflare
  outage demonstrated this pattern — Cloudflare's own status page was
  inaccessible during the incident.
- A regional Cloudflare network issue can mask a real customer-facing
  outage when the probe runs from the same regional pop that is failing.
- A misconfigured Cloudflare Worker route can silently black-hole traffic
  to our `apps/api` and `apps/web` deploys without affecting the
  Cloudflare-native probe runner's connectivity to those routes — the
  probe sees a healthy `200` while real users see Cloudflare's
  generic error page.

The probe vendor MUST be operationally independent so any combination of
the above failure modes still pages.

## Rejected — Synthetic checks via GitHub Actions cron

A GitHub Actions workflow firing `curl` on a 5-minute schedule would
satisfy the independence requirement at zero monetary cost but was
rejected on three grounds:

- **Scheduled-workflow latency is too high.** Cron triggers in GitHub
  Actions queue behind paid workloads during peak times; the SLA is
  "best-effort within 15 minutes" per GitHub's own scheduling docs. A
  60-second probe interval is unachievable.
- **Multi-region coverage is fictional.** GitHub Actions runners are
  pooled in a single Microsoft Azure region per scheduled run; the
  "≥ 2 regions" constraint is unsatisfiable without paying for self-hosted
  runners in multiple regions, which inverts the cost argument.
- **Alert routing requires extra plumbing.** The workflow would need to
  POST to a webhook (Slack, email forwarder) on failure, which
  re-introduces a vendor dependency without the probe-vendor's built-in
  rule engine for two-consecutive-failure semantics.

## Rejected — Datadog Synthetics as part of a unified observability vendor

ADR-012 already rejected Datadog as the unified observability vendor on
free-tier sizing grounds; Datadog Synthetics inherits the same blocker.
Better Stack's free tier and Team plan are sized for an MVP beta;
Datadog Synthetics' minimum spend ($5/check/month at a 1-minute interval)
overruns the Epic-level $50/month ceiling on its own before Sentry or
Logpush enter the budget.

## Consequences

- **IaC is the source of truth for probe configuration.** The
  `infra/uptime/betterstack.yml` file is committed under version
  control; manual changes in the Better Stack UI are out-of-band and
  will be overwritten by the next IaC apply. The apply runbook lives at
  [`infra/uptime/README.md`](../../infra/uptime/README.md).
- **Probe-frequency upgrade gate.** The MVP scope ships on the free
  tier (3-minute probe interval); the Tech Spec's 60-second cadence
  requires upgrading to the Team plan ($29/month seat) before
  production launch. The upgrade is a single Epic-close checklist item
  and is tracked in the FinOps cost-ceiling doc named in ADR-012.
- **Vendor-substitution surface is one file.** Swapping to Pingdom or
  Uptime.com is a single PR: replace `infra/uptime/betterstack.yml`
  with the substitute's IaC dialect and update `infra/uptime/README.md`.
  No application code changes.
- **Alert-rule independence from Cloudflare is structural, not
  aspirational.** A future change that moves probe-runner hosting onto
  Cloudflare-fronted infrastructure (e.g. a vendor acquisition) MUST
  trigger a new ADR superseding this one — the independence rationale
  is the load-bearing constraint, and the gate is a vendor evaluation,
  not an in-PR review topic.
- **`OBSERVABILITY_ALERT_EMAIL` is the single rendered destination.**
  The IaC file references the env var rather than hardcoding the
  inbox so the test-vs-production alerting paths can be wired to
  different inboxes during rehearsal without forking the YAML.

## Rollback

If Better Stack's free-or-Team tier changes shape (probe-frequency
floor rises, multi-region coverage degrades, or a billing-surprise
upgrade is forced), the rollback is:

1. Provision an account with the highest-priority substitute (Pingdom).
2. Replace `infra/uptime/betterstack.yml` with the substitute's IaC
   dialect (Terraform `pingdom_check` resources or Uptime.com REST-API
   payloads) preserving the three target URLs, ≥2 regions per monitor,
   60-second interval, and 2-consecutive-failure threshold.
3. Update `infra/uptime/README.md` with the substitute's apply command.
4. Rotate the alert destination through `OBSERVABILITY_ALERT_EMAIL` so
   no inbox change is needed.
5. Supersede this ADR with one recording the switch rationale.

No application code, no test-suite change, no schema migration. The
vendor-coupling surface is a single IaC file by design.

## Cross-references

- ADR-012 — Observability vendor stack (MVP beta): names Better Stack
  as the default; this ADR backs that default with the per-vendor
  comparison.
- Tech Spec #246 § "Uptime probes": pins the three target URLs, the
  60-second probe interval, the ≥2-region requirement, and the
  two-consecutive-failure threshold.
- PRD #245: the parent Epic's product requirements for observability.
- `infra/uptime/betterstack.yml`: the IaC encoding of the decision.
- `infra/uptime/README.md`: the apply runbook for the chosen vendor.
