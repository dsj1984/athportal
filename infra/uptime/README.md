# Uptime monitor IaC (Better Stack)

This directory encodes the external uptime probes named in
[Tech Spec #246 § "Uptime probes"](https://github.com/dsj1984/athportal/issues/246)
and backed by [ADR 0003 — Uptime probe vendor selection](../../docs/decisions/0003-uptime-vendor.md).
The IaC file [`betterstack.yml`](./betterstack.yml) is the source of truth
for probe configuration; manual changes made in the Better Stack web UI
are out-of-band and will be overwritten by the next apply.

## Files

| File | Purpose |
| --- | --- |
| [`betterstack.yml`](./betterstack.yml) | Three monitor declarations covering API `/health`, web origin `/`, and `/auth/callback`. Each monitor declares the target URL, expected status, probe interval, regions, the two-consecutive-failure alert policy, and the alert destination. |
| [`README.md`](./README.md) | This file. |

## Required environment variables

The apply path reads two environment variables; neither is committed to
the repository.

| Env var | Source | Purpose |
| --- | --- | --- |
| `BETTERSTACK_API_TOKEN` | GitHub Actions secret (operator-provisioned) | Personal access token from <https://uptime.betterstack.com/team/api-tokens>. Scoped to the Better Stack team that owns the three monitors. |
| `OBSERVABILITY_ALERT_EMAIL` | GitHub Actions secret (operator-provisioned) | The single operator-email channel of record named in ADR-012. All Better Stack failure rules render `alert_destination` from this var so test vs. production runs can target different inboxes without forking the YAML. |

## Apply procedure (Better Stack CLI)

> The Better Stack CLI ships as a single Go binary distributed via
> Homebrew (`brew install betterstack-cli`) on macOS and from
> <https://github.com/BetterStackHQ/cli/releases> on Linux and Windows.
> Pin the CLI version in the apply workflow so reproducible apply runs
> are deterministic.

The CLI's `apply` subcommand consumes a YAML manifest and performs an
idempotent reconciliation against the team's monitors. Run from the
repository root so the relative path to the manifest is stable:

```bash
# 1. Authenticate the CLI session for this shell.
export BETTERSTACK_API_TOKEN="$(gh secret list --json name,value \
  --jq '.[] | select(.name=="BETTERSTACK_API_TOKEN") | .value')"

# 2. Render the env-var references in the manifest.
export OBSERVABILITY_ALERT_EMAIL="$(gh secret list --json name,value \
  --jq '.[] | select(.name=="OBSERVABILITY_ALERT_EMAIL") | .value')"

# 3. Apply (idempotent; reconciles to declared shape).
betterstack apply --file infra/uptime/betterstack.yml

# 4. Verify the three monitors exist and are reporting.
betterstack monitors list --output table
```

A successful apply prints a JSON diff naming the monitors created,
updated, or left untouched. Re-running `apply` with no manifest changes
must be a no-op — the file is the source of truth, and drift detected
by the CLI is reported on stderr.

## Diff-only / plan mode

To preview the change set without mutating remote state:

```bash
betterstack apply --file infra/uptime/betterstack.yml --dry-run
```

The `--dry-run` flag prints the same diff as the live apply, suffixed
with `(no changes applied)`. Use this in pull-request CI to surface
proposed manifest changes for review without requiring write
credentials.

## Initial bootstrap (first apply only)

Before the first apply, the operator MUST:

1. Provision the Better Stack team and a paid Team-plan seat
   (`$29/month`) — the 60-second probe interval pinned by Tech Spec
   #246 exceeds the free-tier minimum of 3 minutes. See ADR 0003 for
   the seat-cost rationale.
2. Create the API token under
   <https://uptime.betterstack.com/team/api-tokens>; store it in the
   GitHub Actions environment as `BETTERSTACK_API_TOKEN`.
3. Configure the operator inbox under the team's "Email integrations"
   page; store the same address in the GitHub Actions environment as
   `OBSERVABILITY_ALERT_EMAIL`.
4. Run `betterstack apply` once locally with the secrets exported to
   confirm the manifest reconciles cleanly; CI inherits the same
   command from then on.

## Vendor substitution

ADR 0003 names Pingdom and Uptime.com as acceptable substitutes. The
substitution surface is exactly the two files in this directory: replace
`betterstack.yml` with the substitute's IaC dialect (Terraform
`pingdom_check` resources or Uptime.com REST-API payloads) and update
this README's apply procedure. No application code, no test-suite
change.
