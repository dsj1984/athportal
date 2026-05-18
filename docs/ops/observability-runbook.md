# Observability Runbook — Alert Triage and Rehearsal

> **Status:** Authoritative operator procedure for every alert produced by the
> observability vendor stack (Epic #5).
> **ADR:** [ADR-012 — Observability vendor stack](../decisions.md#adr-012--observability-vendor-stack-mvp-beta),
> [ADR 0001 — Sentry organization and region](../decisions/0001-sentry-org-and-region.md),
> [ADR 0003 — Uptime probe vendor selection](../decisions/0003-uptime-vendor.md).
> **Tech Spec:** [#246](https://github.com/dsj1984/athportal/issues/246).
> **Companion docs:** [`observability-redaction.md`](./observability-redaction.md)
> (PII trust boundary), [`infra/uptime/README.md`](../../infra/uptime/README.md)
> (Better Stack apply procedure).

## Audience and scope

This runbook is the single operational handbook every alert email links to.
It assumes the operator has read access to the four vendor consoles named
below and write access to the GitHub repository for re-running deploys or
toggling the synthetic-failure flag. It covers the **MVP beta** observability
stack — SOC-style alerting, log-integrity proofs, and customer-managed-key
encryption are explicitly out of scope per Tech Spec #246 § "What this Epic
does NOT secure".

## The canonical alert channel

**Every alert produced by the observability stack is delivered to the
single operator-email distribution list of record.** The distribution list
is provisioned per environment and stored in the
`OBSERVABILITY_ALERT_EMAIL` GitHub Actions / Cloudflare Workers secret.
This is the single channel of record named in ADR-012 § "Alerting channel"
and re-affirmed in ADR 0003 § "Alerting destination is the single operator
email". There is no parallel paging path (SMS, Pushover, PagerDuty) at the
MVP beta — the email channel is the single fail-safe.

The distribution-list shape (not a personal inbox) is load-bearing: on-call
rotation, vacation hand-off, and team growth all happen by updating the
list membership in the email provider, not by editing IaC or rotating
secrets. **If you are reading an alert email, you are on the list because
you are on-call — acknowledge by replying-all so the rest of the list knows
the alert is being triaged.**

## Vendor consoles

The four vendors that emit into the operator-email distribution list, with
the console URL each alert links back to:

| Vendor              | What it watches                                  | Console URL                                              |
| ------------------- | ------------------------------------------------ | -------------------------------------------------------- |
| **Sentry**          | Application errors, stack traces, breadcrumbs (Workers / web / mobile) | <https://sentry.io/organizations/athportal/issues/>      |
| **Cloudflare**      | Workers Analytics Engine + Logpush egress to the managed sink | <https://dash.cloudflare.com/?to=/:account/workers/analytics-engine> |
| **Managed log sink** _(vendor TBD — Datadog Logs / Better Stack Logs / Axiom)_ | Structured request-completion events shipped via Logpush | Sink-vendor selection is deferred to a follow-on Story; this row is updated when the sink-vendor ADR lands. Until then, query Cloudflare's Logpush job status directly via the Cloudflare console row above. |
| **Better Stack**    | External uptime probes from ≥2 regions on `/health`, `/`, `/auth/callback` | <https://uptime.betterstack.com/team/monitors>           |

All four vendors render their alert destination from
`OBSERVABILITY_ALERT_EMAIL`. A vendor-side outage that prevents an alert
from being delivered to the list MUST be treated as the same incident
class as the underlying failure — see [§ Synthetic-failure rehearsal](#synthetic-failure-rehearsal).

---

## Receiving an alert

Every observability alert lands in the operator-email distribution list
with a subject prefix that identifies the source vendor. The first step
on every alert is the same:

1. **Acknowledge by replying-all to the distribution list.** A single
   line (`"Triaging — <your name>"`) is enough. This is the contract that
   keeps two operators from independently triaging the same alert.
2. **Read the alert body in full before clicking through.** Each vendor's
   alert template carries the minimum context needed to route the incident
   without opening the console: target URL (Better Stack), error class
   and runtime (Sentry), or log-sink query link (managed sink).
3. **Identify the alert source from the subject prefix:**
   - `[Sentry]` → see [§ Triage in Sentry](#triage-in-sentry).
   - `[Better Stack]` → see [§ Inspecting uptime probe history](#inspecting-uptime-probe-history).
   - `[Logpush]` / `[<sink-vendor>]` → see [§ Querying the log sink](#querying-the-log-sink).
   - `[Cloudflare]` → an Analytics Engine or Logpush pipeline alert; see
     [§ Querying the log sink](#querying-the-log-sink) for the egress
     pipeline and the Cloudflare console row above for the source.
4. **Establish blast radius before remediating.** If `/health` and `/`
   are both alerting, the incident is API-wide. If only `/auth/callback`
   is alerting, the incident is auth-scoped. Better Stack's monitor list
   view shows all three monitors side-by-side and is the fastest way to
   answer this question — open
   <https://uptime.betterstack.com/team/monitors> before opening any other
   console.
5. **Capture a short incident note in the reply-all thread.** What is
   failing, the suspected scope, and the next action. Keep the thread as
   the single timeline; it becomes the post-incident artifact.

If the alert turns out to be a rehearsal (synthetic-failure flag was
flipped intentionally), reply-all with `"Rehearsal — expected"` and
proceed to [§ Synthetic-failure rehearsal](#synthetic-failure-rehearsal) §
Confirming the rehearsal fired.

---

## Triage in Sentry

Sentry alerts fire when an unhandled exception escapes the Workers / web
/ mobile SDK boundary. The Workers runtime sends to the Sentry project
named in ADR 0001; the web and mobile runtimes send to their per-runtime
projects (see Tech Spec #246 § "Sourcemap upload per runtime").

1. **Open the issue link in the alert email.** It deep-links to
   <https://sentry.io/organizations/athportal/issues/> filtered to the
   firing issue.
2. **Confirm the environment.** Sentry's issue header shows
   `environment: staging` or `environment: production`. A staging-tagged
   issue does NOT page out-of-hours unless it correlates with a Better
   Stack alert on the same surface.
3. **Read the stack trace top-down.** Sourcemap upload runs on every
   authenticated CI deploy (Tech Spec #246 § "Sourcemap upload per
   runtime"), so the frames resolve to the original TypeScript source.
   If a frame is missing source, check that the deploy that produced the
   release (the `SENTRY_RELEASE` git SHA on the issue) actually ran the
   sourcemap-upload step — fork-PR builds skip the step by design.
4. **Check breadcrumbs for the redacted request envelope.** Per
   [`observability-redaction.md`](./observability-redaction.md), the
   request envelope on each event is filtered through the single
   allowlist (`user-agent`, `cf-ray`, `cf-ipcountry`, `x-request-id`,
   `accept-language` for headers; `cursor`, `limit`, `order`, `sort` for
   query keys; empty Set for body keys). If you need a field that is not
   in the allowlist, **do not add it to a one-off Sentry tag** — the
   widening procedure is the ADR template at
   [`docs/decisions/_template-redaction-widening.md`](../decisions/_template-redaction-widening.md).
5. **Correlate with the log sink.** Every Sentry event carries the
   `x-request-id` breadcrumb; copy it and search the managed log sink (see
   below) for the same `x-request-id` to see the surrounding request
   pattern on that Worker invocation.
6. **Assign the issue to yourself in Sentry.** This is what unlocks the
   "Resolve in next release" workflow if the fix lands in the same
   deploy that suppresses the alert.

If Sentry is itself unreachable, treat the incident as a Sentry outage
and fall back to Cloudflare's own Workers logs in the Cloudflare console
(the same dashboard URL above). The Workers Analytics Engine row in
that dashboard is the source-of-truth for request shape even when Sentry
is down.

---

## Querying the log sink

Structured request-completion events ship from Cloudflare Workers
Analytics Engine via Logpush into the managed log sink. The sink vendor
is deferred to a follow-on Story; until that ADR lands, query the
Cloudflare Analytics Engine dashboard directly:

1. **Open the Cloudflare console** at
   <https://dash.cloudflare.com/?to=/:account/workers/analytics-engine>
   and select the `athportal_request_log` dataset (the binding declared
   in `apps/api/wrangler.toml` per Tech Spec #246 § "CI / deploy wiring").
2. **Scope the query by `x-request-id` first.** Every event in the
   dataset carries the redacted `x-request-id` from the request
   envelope; an alert almost always names a specific request the
   operator is trying to reproduce. The `x-request-id` is the fastest
   join key between Sentry and the log sink.
3. **Filter by `status >= 500` for application errors** or
   `error_class IS NOT NULL` for thrown handlers. The `LogEvent` schema
   (Tech Spec #246 § "Data Models") guarantees both fields are
   well-typed.
4. **Filter by `route_pattern`, not raw URL.** The middleware records
   the Hono `c.req.routePath` (e.g. `/api/v1/teams/:teamId`), not the
   resolved URL — this lets a single query aggregate across all athletes
   without leaking athlete IDs into the dashboard.
5. **Inspect `metadata` only for allowlisted keys.** The same allowlist
   that governs Sentry envelopes governs the log sink (per
   [`observability-redaction.md`](./observability-redaction.md)). If a
   field you expect is missing, the answer is the same: open a widening
   ADR using the template at
   [`docs/decisions/_template-redaction-widening.md`](../decisions/_template-redaction-widening.md).

Once the sink-vendor ADR lands, this section is updated with the
vendor's console URL and the query syntax (Datadog query language,
Better Stack Logs query, or Axiom APL). The Cloudflare console row above
remains the fallback when the sink vendor is itself unreachable.

If Logpush itself is alerting (Cloudflare-side pipeline failure), open
the Cloudflare console row above and inspect the Logpush job status; a
failing Logpush job is the most common cause of the sink falling silent
while Cloudflare itself stays healthy.

---

## Inspecting uptime probe history

Better Stack probes every 60 seconds from at least two distinct regions
(`us-east-1` and `eu-west-1` at minimum) and fires an alert after **two**
consecutive failures (per ADR 0003 § "Two-consecutive-failure threshold
is mandatory"). Single-region transient flaps are silenced by the
threshold; an alert means at least two minutes of sustained failure from
at least one region.

1. **Open the Better Stack monitor list** at
   <https://uptime.betterstack.com/team/monitors>. The three monitors
   declared in
   [`infra/uptime/betterstack.yml`](../../infra/uptime/betterstack.yml)
   are listed by name: `API health (athportal)`,
   `Web origin (athportal)`, `Auth callback (athportal)`.
2. **Click the firing monitor to see the probe-history timeline.** The
   timeline shows pass/fail per region per probe interval; a
   single-region red stripe with the other region green strongly
   suggests a regional Cloudflare or DNS issue rather than an origin
   outage.
3. **Cross-check with the Cloudflare console.** If Better Stack shows
   the origin returning `5xx` but Cloudflare's Workers Analytics Engine
   row shows the same Worker handling 200s for other requests, the
   incident is request-scoped (a specific route or method) rather than
   Worker-wide.
4. **Cross-check with Sentry.** A Better Stack `/health` failure with
   no corresponding Sentry event means the Worker is not reaching the
   exception path (likely a Cloudflare-routing or wrangler-config
   issue); a Better Stack `/health` failure with a Sentry event means
   the application code is throwing on the health-check path.
5. **Do NOT silence a monitor without resolving the alert.** The IaC
   file is the source of truth (per ADR 0003); a manual mute in the
   Better Stack UI is overwritten on the next apply. If a monitor needs
   to be temporarily disabled (e.g. a planned maintenance window),
   change `failure_threshold` in
   [`infra/uptime/betterstack.yml`](../../infra/uptime/betterstack.yml)
   and re-apply per the procedure at
   [`infra/uptime/README.md`](../../infra/uptime/README.md), then revert
   the change once the window closes.

If Better Stack itself is unreachable, the substitute set named in ADR
0003 (Pingdom, then Uptime.com) is the documented fallback — but a
substitute switch is a bounded one-Story migration, not an in-incident
action.

---

## Synthetic-failure rehearsal

The synthetic-failure endpoint at `POST /api/v1/_debug/synthetic-failure`
is the canonical way to confirm that the entire alert path —
application throw → Sentry capture → Sentry alert rule → operator email
distribution list — is reachable end-to-end. The endpoint is gated
behind the `OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED` Workers secret
(Tech Spec #246 § "Synthetic-failure endpoint") and returns `404` —
indistinguishable from a non-existent route, never `403` — when the
gate is closed. **The flag is set in staging only; it is never set in
production.** The production Worker MUST refuse to ship with the secret
configured, and the rehearsal procedure below is the only sanctioned
path that ever flips the flag on.

The rehearsal cadence is **once per quarter at minimum**, and ad-hoc
after any change to the alert path (Sentry alert-rule edit,
distribution-list membership change, Better Stack rule change, vendor
substitution per ADR 0003). The cadence is intentionally not in
calendar form here; the FinOps cost-ceiling doc names the cadence-owner
when it lands per Tech Spec #246 § "Core Components" row 13.

### Step-by-step

1. **Announce the rehearsal in the distribution list before firing.**
   Reply-all to the most recent thread (or open a new one with subject
   `"Rehearsal — synthetic-failure"`) so any operator who sees the
   resulting alert knows it is expected. The announcement must include
   the environment (`staging` only — the production secret is never set
   by default) and the planned trigger window.
2. **Set the synthetic-failure flag in staging.** From an authenticated
   shell with the staging Cloudflare credentials:
   ```bash
   wrangler secret put OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED --env staging
   # paste the value: true
   ```
3. **Fire the synthetic-failure endpoint once.** From an authenticated
   shell with read access to the staging origin:
   ```bash
   curl -X POST https://api-staging.athportal/api/v1/_debug/synthetic-failure
   ```
   The handler throws `SyntheticFailureError`; the Workers Sentry SDK
   captures the exception and the matching Sentry alert rule fires into
   the operator-email distribution list.
4. **Confirm the alert lands within the configured Sentry alert
   window.** Sentry's default alert rule for the Workers project fires
   within one minute; if the alert does not arrive in five minutes, the
   alert path is broken and the rehearsal has done its job — open an
   incident in the distribution-list thread.
5. **Unset the synthetic-failure flag.** Leaving the secret set is the
   single most common rehearsal mistake; the next ambient deploy will
   re-evaluate the flag and the endpoint will start throwing on every
   real probe. Unset with:
   ```bash
   wrangler secret delete OBSERVABILITY_SYNTHETIC_FAILURE_ENABLED --env staging
   ```
6. **Confirm the endpoint returns to `404`.** Re-run the `curl` from
   step 3; the expected response is `404`, indistinguishable from a
   non-existent route (per Tech Spec #246 § "Synthetic-failure endpoint
   exposure surface").
7. **Reply-all with the rehearsal result.** A single line is enough:
   `"Rehearsal complete — alert arrived in <N> seconds, flag unset,
   endpoint returns 404."` The thread becomes the post-rehearsal
   artifact for the next quarterly cadence.

### Confirming a rehearsal fired

If you receive an alert that the announcement thread named as a
rehearsal:

1. Reply-all with `"Rehearsal — expected"` to suppress duplicate
   triage.
2. Note the latency from `curl` to alert delivery in the same thread —
   that latency is the load-bearing measurement for the rehearsal.
3. Do not open the Sentry issue as resolved; the rehearsal operator
   resolves it as part of step 7 above.

### What the rehearsal does NOT cover

The synthetic-failure endpoint exercises the Sentry alert path
end-to-end. It does NOT exercise the Better Stack uptime path (probe
runs are continuous and self-rehearsing by design) or the log-sink
egress path (Logpush is continuous). If you need to rehearse the
uptime alert path, point a Better Stack monitor at a deliberately
broken URL in staging for a single probe interval and revert; if you
need to rehearse the log-sink path, the egress is on every real
request and a structured query against the sink will show the most
recent event delivered within seconds.

---

## Nightly Lighthouse baseline setup

The nightly workflow ([`.github/workflows/nightly.yml`](../../.github/workflows/nightly.yml))
runs `pnpm run lighthouse:check` against a staging preview URL pulled from
the `LIGHTHOUSE_PREVIEW_URL` Environment Secret on the `staging` GitHub
Environment. Until the secret is set, the job exits non-zero with an
actionable `LIGHTHOUSE_PREVIEW_URL is not set` message — the unprimed-skip
path inside `scripts/lighthouse-baseline.mjs` only fires once the preview
URL is configured.

### Setting the secret

After the next staging deploy URL is finalized, set the secret from the
operator workstation (or any host with `gh auth login` against the repo):

```bash
gh secret set --env staging LIGHTHOUSE_PREVIEW_URL --body "https://<staging-url>"
```

Notes:

- The secret is per-environment, not repo-level. `gh secret set` without
  `--env staging` would write a repo-level secret that the nightly job
  cannot read (the `lighthouse-baseline` job declares `environment: staging`
  so only Environment-scoped secrets are visible).
- The URL must be the base origin (`https://host`), without a trailing
  path. The script appends the per-route slug from `baselines/lighthouse.json`.
- Rotate by re-running the same command with the new URL. There is no
  separate "unset" command — `gh secret delete --env staging LIGHTHOUSE_PREVIEW_URL`
  removes it and the nightly job returns to the actionable-failure state.

### Priming the baseline

The baseline at [`baselines/lighthouse.json`](../../baselines/lighthouse.json)
ships unprimed (every route at score 0). With the secret set, the nightly
job's `lighthouse:check` step exits 0 with a "baseline is unprimed" message
until an operator runs `pnpm run lighthouse:update` against the staging
preview to capture the first real measurements. Commit the regenerated
baseline; the next nightly enforces the +/-3 per-metric / per-route band.

---

## Related

- [ADR-012 — Observability vendor stack (MVP beta)](../decisions.md#adr-012--observability-vendor-stack-mvp-beta)
  — the vendor stack and the canonical alert channel.
- [ADR 0001 — Sentry organization and region](../decisions/0001-sentry-org-and-region.md)
  — Sentry org slug and EU residency selection.
- [ADR 0003 — Uptime probe vendor selection (Better Stack default)](../decisions/0003-uptime-vendor.md)
  — probe-vendor independence rationale and the two-consecutive-failure
  threshold.
- [`observability-redaction.md`](./observability-redaction.md) — the
  single PII trust boundary every log event passes through.
- [`infra/uptime/betterstack.yml`](../../infra/uptime/betterstack.yml)
  — IaC source of truth for the three uptime monitors.
- [`infra/uptime/README.md`](../../infra/uptime/README.md) — Better
  Stack apply procedure.
- [Tech Spec #246](https://github.com/dsj1984/athportal/issues/246) —
  Epic-level technical specification.
- [`.agents/rules/security-baseline.md`](../../.agents/rules/security-baseline.md)
  § Data Leakage & Logging — the framework-level rule the redaction
  allowlist enforces.
