# Web Routes — Indexing Posture

This document is the canonical route-posture table for the `apps/web`
surface. It records the **default indexing posture** for each route
prefix the MVP will ship, plus the per-resource override behaviour where
applicable. The build-time
`apps/web/scripts/generate-robots.mjs` step (deferred to the `apps/web`
scaffolding Epic) reads this surface to emit
`apps/web/public/robots.txt` with `Disallow:` rules for every
`noindex` prefix. Hand-editing `robots.txt` is forbidden — this table is
the single source of truth.

The posture policy itself is pinned in
[`docs/decisions.md` — 2026-05-17 — Indexing posture](./decisions.md#2026-05-17--indexing-posture-default-allow-on-public-noindex-on-signed-in-and-private).
Read that ADR for the why; this table is the operational what.

## Indexing posture key

- **allow** — Route is crawlable. No `noindex` meta tag and no
  `X-Robots-Tag: noindex` header. Search engines may index the rendered
  HTML.
- **noindex** — Route emits `<meta name="robots" content="noindex,
  nofollow" />` in the document head **and** a matching
  `X-Robots-Tag: noindex, nofollow` response header. Both controls run
  together by design — the header is the load-bearing control for
  crawlers that ignore HTML.

## Route-prefix posture (MVP)

| Route prefix | Default indexing posture | Per-resource override notes |
| --- | --- | --- |
| `/` (marketing root) | **allow** | None — marketing surfaces are always crawlable. |
| `/about`, `/pricing`, `/legal/*` (static marketing) | **allow** | None. |
| `/o/<orgSlug>`, `/t/<teamSlug>`, `/e/<eventSlug>` (public discovery) | **allow** | Resource may flip to **noindex** by setting its `isPublic` flag to `false` (filtered at the query layer per [ADR-008](./decisions.md#adr-008--slug-first-public-discovery-surface)) or by setting an explicit per-resource `indexable = false` flag while remaining publicly viewable. |
| `/share/<token>` (anonymous share links) | **noindex** | Share-link surfaces are unguessable tokens; they are never indexed even though they are reachable without auth. No per-resource override. |
| `/r/roster-invite/<token>/{accept,decline}` (Epic #11 roster-invite public handshake) | **noindex** | Tokenized public-handshake landing pages reached only from a coach-issued invite email. Unguessable token, no enumeration surface, never indexed. No per-resource override. |
| `/sign-in`, `/sign-up`, `/sign-out` (auth entry points) | **noindex** | None — auth surfaces are noindex by policy. |
| `/onboarding` (post-auth onboarding gate per [ADR-005](./decisions.md#adr-005--jit-user-provisioning--mandatory-onboarding-gate)) | **noindex** | None. |
| `/app/*` (signed-in dashboards, owner-only management UI) | **noindex** | None — all `/app/*` routes require auth and are always noindex. |
| `/settings/*` (signed-in user / org settings) | **noindex** | None. |
| `/api/*` (API surface; not server-rendered HTML) | **noindex** | API responses are not HTML and are not in the crawlable surface; the `noindex` header is emitted as defense-in-depth in case an HTML error page is ever returned from this prefix. |

## Editing rules

- A new route prefix lands as a new row in the table above **in the same
  change** that introduces the prefix. Adding routes without recording
  their posture is a review blocker.
- A change to a prefix's default posture lands alongside an updated
  paragraph in the indexing-posture ADR
  ([`docs/decisions.md`](./decisions.md#2026-05-17--indexing-posture-default-allow-on-public-noindex-on-signed-in-and-private))
  explaining the rationale.
- Per-resource overrides are described in this column only when the
  resource actually has an override hook; do not invent overrides that
  the resource layer does not support.
- The generated `robots.txt` MUST match this table. If they drift, fix
  this table (and re-run the generator) — never hand-edit `robots.txt`.
