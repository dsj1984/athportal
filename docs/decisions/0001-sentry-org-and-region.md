# 0001 — Sentry organization, data-residency region, and project layout

**Status**: Accepted

**Date**: 2026-05-17

**Supersedes**: none

**Related**: [`docs/decisions.md` § ADR-012 — Observability vendor stack (MVP beta)](../decisions.md#adr-012--observability-vendor-stack-mvp-beta)

---

## Context

ADR-012 ratified Sentry as the error-tracking vendor across `apps/api`,
`apps/web`, and `apps/mobile`. Before Story #255 wires the per-runtime
init wrappers (`@sentry/cloudflare`, `@sentry/astro`, `sentry-expo`), three
account-shape decisions need to be locked so DSNs, sourcemap-upload
tokens, and CI environment-variable contracts can be provisioned without
re-cutting them mid-Epic:

1. **Which Sentry organization owns the data.** A single org keeps
   billing, alert routing, and team membership in one place; multiple
   orgs would force every CI workflow to carry one auth token per org
   and split the alert inbox.
2. **Which data-residency region (EU vs US) the org is created in.**
   Sentry's region is a one-way choice — events ingested into a US org
   cannot be migrated to EU and vice versa. The choice has to align with
   the team's data-residency posture (athlete data, GDPR exposure) and
   with the regions Cloudflare and Turso are configured for.
3. **The project layout.** Sentry projects are the unit of DSN, alert
   rule, release tag, and quota. A single shared project muddles the
   three runtimes' signal; one project per runtime is the natural
   boundary the init wrappers in Story #255 already key off.

The `s-sentry-baseline` initializer assumes a stable account shape from
day one; without an ADR, the org / region / projects would be created
ad-hoc by whoever first runs `sentry-cli login`, with no documented
rationale and no path to ratify changes later.

## Decision

- **Organization**: a single Sentry organization named **`athportal`**
  owns event data for all three runtimes. Billing is consolidated; team
  membership is one access-control surface; the alert inbox is one
  routing target — aligned with ADR-012's "alerting channel of record
  is the operator's email" baseline.
- **Region**: the org is provisioned in the **EU (Frankfurt) region**.
  Athlete data has direct GDPR exposure (EU-resident users), and the
  rest of the production stack (Cloudflare Workers metadata, Turso
  primary) is already configured EU-first. A US-region org would push
  ingested events out of the EU boundary even when redacted, which the
  redaction allowlist at `packages/shared/src/observability/redaction.ts`
  cannot remediate.
- **Project layout**: three projects, one per runtime, mapped 1:1 to the
  per-runtime DSN env vars Story #255 introduces:
  - **`workers`** — Cloudflare Workers (`apps/api`) — DSN
    `SENTRY_DSN_WORKERS`; init wrapper at `apps/api/src/sentry.ts`.
  - **`web`** — Astro web runtime (`apps/web`) — DSN
    `SENTRY_DSN_WEB`; init wrapper at `apps/web/src/sentry.ts` +
    integration mounted from `apps/web/astro.config.ts`.
  - **`mobile`** — Expo / React Native (`apps/mobile`) — DSN
    `SENTRY_DSN_MOBILE`; init wrapper at `apps/mobile/src/sentry.ts` +
    `sentry-expo` plugin registered from `apps/mobile/app.config.ts`.
  Each project carries its own DSN, its own release-tag stream (keyed
  off the deploy SHA), and its own alert rules. Staging and production
  share the same project per runtime — environment differentiation is
  done via Sentry's `environment` tag, not via parallel projects, to
  keep release / regression comparisons intra-project.

## Rejected alternatives

- **One shared project across all runtimes.** Rejected: a single DSN
  collapses the three runtimes' release streams into one timeline, which
  defeats per-runtime regression tracking and forces every alert rule
  to filter by `sdk.name` to be useful.
- **One project per runtime per environment** (six projects: workers-staging,
  workers-prod, web-staging, ...). Rejected: doubles the DSN surface
  area, fragments the release timeline, and makes "did the same bug
  appear in staging?" require cross-project queries. The `environment`
  tag is the documented Sentry primitive for this dimension.
- **US-region org.** Rejected: incompatible with the EU-first data
  posture of the rest of the stack. The cost of getting this wrong is
  unrecoverable — Sentry's region is a one-way choice.
- **Self-hosted Sentry.** Rejected at MVP: operational cost (a
  Postgres + Kafka + Snuba stack to babysit) far exceeds the $50/month
  ceiling ADR-012 ratifies for the beta. Revisit if the cost ceiling
  becomes binding.

## Consequences

- **CI secrets contract.** Three per-runtime DSNs
  (`SENTRY_DSN_WORKERS`, `SENTRY_DSN_WEB`, `SENTRY_DSN_MOBILE`) plus the
  shared `SENTRY_AUTH_TOKEN` (sourcemap upload) are the four Sentry
  secrets the deploy workflows provision. Workers and Web pull from
  GitHub Environment Secrets; Mobile pulls from EAS Secrets at build
  time. The env-var contract is documented in
  [`.env.example`](../../.env.example) and the
  [environment-variables table in `README.md`](../../README.md#environment-variables).
- **Alert routing.** Per-project alert rules forward to the same operator
  email (per ADR-012); the routing rule on each project is the unit of
  noise-tuning. No SMS / Pushover / PagerDuty channel is added beyond
  the beta scope.
- **Migration cost is bounded.** Per ADR-012, swapping vendors is one
  Story per runtime. The three-project layout keeps that contract intact
  — each runtime can migrate independently without touching the other
  two.
- **Region cannot be revisited cheaply.** Moving from EU to US (or back)
  requires creating a new org, re-provisioning DSNs, and accepting that
  historical events stay in the old region. Any future ADR that
  supersedes this one MUST document the migration cost up front.
- **EU region affects free-tier quotas in the same way as US.** No quota
  arbitrage was traded away; the choice is purely residency-driven.
