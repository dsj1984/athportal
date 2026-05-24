# Platform Design System & Style Guide

This document outlines the visual identity, brand guidelines, and technical
configurations for the platform. It is the definitive reference for designing,
developing, and styling all user interfaces.

## Live reference: `/internal/styleguide`

The canonical **live** reference for every primitive shipped by Epic
702 (Design system) lives at
[`/internal/styleguide`](../apps/web/src/pages/internal/styleguide.astro).
That page renders the actual `apps/web/src/components/ui/*` primitives
against the actual `global.css` token catalogue — when this document
and the live page disagree, the live page wins; raise a docs PR to
re-sync.

* **Auth gate.** The route is `dev_admin`-gated via
  `decideStyleguideAccess` (Story #723 / Task #734). Non-`dev_admin`
  callers receive a 302 to `/` and the response always carries an
  `X-Robots-Tag: noindex, nofollow` header.
* **What it documents.** Four reference sections — Foundations
  (tokens, typography, palette), Interactive atoms (`Btn`, `Input`,
  `Select`, `Textarea`), Display atoms (`Badge`, `Stat`, `Ring`,
  `Avatar`, `VerifiedTick`, `Ph`), and Composites (`Card`, `Shell`,
  `Topbar`, `Sidebar`, `EmptyState`, `EventChip`, `ToastHost`).
* **Code rule.** Consumers import primitives from
  `apps/web/src/components/ui/*` — see
  [`docs/patterns.md` § *Primitive library*](patterns.md#primitive-library)
  for the import-this-not-Tailwind contributor rule.

## 1. Core Design Philosophy

The platform is a dual-sided marketplace targeting a younger demographic (< 24)
while satisfying administrative stakeholders. Four principles govern every
design decision:

1. **Light, Airy, and Modern** — The sole theme is a clean light mode. The
   aesthetic leans toward modern creator platforms (Discord, Twitch, TikTok's
   light surfaces) rather than enterprise dashboards. Depth is achieved through
   subtle shadows, tinted borders, and strategic use of accent colors — not by
   darkening backgrounds.

2. **White-Label Ready (WaaS)** — The core UI is an elegant, neutral canvas.
   Brand colors frame user-generated media so client clubs can inject their own
   logos and primary colors without visual clashing.

3. **Anti-Cliché** — No exhausted sports tropes. No generic "neon green and
   navy blue" pairings, literal clip-art iconography (whistles, soccer balls),
   or hyper-masculine distressed block fonts. Rely on abstract, geometric icons
   that imply connectivity, verification, and data flow.

4. **Accessibility First** — All text must meet WCAG AA contrast (4.5:1 for
   body text, 3:1 for large text and UI components).

---

## 2. Typography System

### Primary Display Font: Space Grotesk

* **Fallback:** system-ui, sans-serif
* **Usage:** Marketing headlines, team hub titles, player card names (H1–H3),
  prominent UI numbers.
* **Weights:** SemiBold (600), Bold (700).
* **Rationale:** Geometric, tech-forward, progressive — without aggressive
  varsity clichés.

### Secondary UI & Body Font: Inter

* **Fallback:** system-ui, sans-serif
* **Usage:** Body text, player statistics, roster tables, academic transcripts,
  compliance dashboards, microcopy.
* **Weights:** Regular (400), Medium (500), SemiBold (600).
* **Rationale:** Exceptional legibility at micro-sizes (11 px+), ideal for
  dense data interfaces.

---

## 3. Color Architecture

### 3.1 Brand Colors

| Name              | Hex       | Usage                                        |
| :---------------- | :-------- | :------------------------------------------- |
| Hyper-Violet      | `#9333EA` | Primary brand, CTAs, active states           |
| Hyper-Violet Dark | `#6B21A8` | Gradients, hover fill, header accents        |
| Hyper-Violet Hover| `#7C22D0` | Button hover midpoint                        |

### 3.2 Functional Accent Colors

| Name          | Hex       | Usage                                            |
| :------------ | :-------- | :----------------------------------------------- |
| Electric Cyan | `#06B6D4` | CTA buttons, "Verified" badges, active nav       |
| Emerald       | `#10B981` | Success states, positive progression markers     |
| Amber         | `#F59E0B` | Warning states, pending requirements             |
| Alert Coral   | `#F43F5E` | Destructive actions, errors, compliance alerts   |
| Action Amber  | `#F59E0B` | Soft warning chips & inline cautions (`--color-action-amber`, Epic #702) |

### 3.3 Surface & Text Tokens

| Token             | Hex       | Usage                    |
| :---------------- | :-------- | :----------------------- |
| Background        | `#F8FAFC` | Page background (Frost)  |
| Surface / Card    | `#FFFFFF` | Card & panel backgrounds |
| Surface Hover     | `#F1F5F9` | Interactive hover tint   |
| Surface Active    | `#E2E8F0` | Pressed / active state   |
| Text Primary      | `#0F1115` | Body and heading text    |
| Text Secondary    | `#475569` | Captions, metadata       |
| Text Tertiary     | `#64748B` | Disabled labels, low-emphasis hints (`--color-text-tertiary`, Epic #702) |
| Border            | `#E2E8F0` | Card edges, dividers     |
| Border Strong     | `#CBD5E1` | Emphasized dividers, focus rims (`--color-border-strong`, Epic #702) |

### 3.4 Component Styling: Translucent "Soft" Badges

Status tags (e.g., "GAME", "PRACTICE", "ADMIN") must **never** use solid dark
backgrounds. Use:

* **Background:** 12–15 % opacity of the accent color
* **Text:** 100 % opacity of the full accent color

This produces vibrant, readable chips similar to Discord role tags, not heavy
solid chips.

```html
<!-- Correct -->
<span class="bg-action-cyan/15 text-action-cyan text-xs font-semibold px-2 py-0.5 rounded-full">
  VERIFIED
</span>

<!-- Incorrect — do not use solid dark backgrounds -->
<span class="bg-cyan-900 text-cyan-100 ...">VERIFIED</span>
```

### 3.5 Radii & Elevation (Epic #702)

Epic #702 codified two scales the primitive library composes against.
Pull radii and shadow values from the tokens below — never inline a
custom `border-radius` or `box-shadow` in a consuming Epic.

#### Radii scale

| Token         | Value | Usage                                            |
| :------------ | :---- | :----------------------------------------------- |
| `--radius-sm` | 6 px  | Inline chips, micro-pills, EventChip stripe rail |
| `--radius-md` | 10 px | Buttons, inputs, EventChip background            |
| `--radius-lg` | 14 px | Cards, hero callouts, modal surfaces             |
| `--radius-xl` | 18 px | Top-level shells, marketing hero blocks          |
| `--radius-2xl`| 24 px | Full-bleed media frames, oversized illustration tiles |

#### Shadow scale

| Token         | Usage                                                          |
| :------------ | :------------------------------------------------------------- |
| `--shadow-xs` | Hairline lift on chips and inline pills                        |
| `--shadow-sm` | Default card resting state                                     |
| `--shadow-md` | Hover / focus lift on interactive cards and dropdowns          |
| `--shadow-lg` | Modal overlays, popovers, focus-trapped sheets                 |

The shadows are tuned for the light surface; do **not** override
opacity or colour values per-Epic — extend the scale here if a new
elevation is genuinely needed.

### 3.6 Monospace surface (Epic #702)

`--font-mono` resolves to the **system monospace stack** —
`ui-monospace, SFMono-Regular, Menlo, monospace`. No third-party
mono font is loaded over the network (Tech Spec #704 explicitly
forbids it). Use this token whenever a surface needs tabular
numerics, raw IDs, or code excerpts (e.g. operator panels, the
internal styleguide, the support-ticket detail view).

---

## 4. Technical Implementation

The project uses **Tailwind CSS v4** with CSS-first configuration. All design
tokens live in `apps/web/src/styles/global.css` inside the `@theme` block.
The `tailwind.config.mjs` file is intentionally empty — **do not add theme
values there**.

### 4.1 CSS Design Tokens (`global.css`)

```css
@import "tailwindcss";

@theme {
  /* ── Brand ──────────────────────────────────── */
  --color-brand:       #9333ea;
  --color-brand-dark:  #6b21a8;
  --color-brand-hover: #7c22d0;

  /* ── Functional Accents ─────────────────────── */
  --color-action-cyan:  #06b6d4;
  --color-action-lime:  #10b981;
  --color-action-amber: #f59e0b;  /* Epic #702 — soft warning chips */
  --color-action-coral: #f43f5e;

  /* ── Surfaces ───────────────────────────────── */
  --color-surface-bg:      #f8fafc;  /* page background   */
  --color-surface-card:    #ffffff;  /* card / panel      */
  --color-surface-hover:   #f1f5f9;  /* interactive hover  */
  --color-surface-active:  #e2e8f0;  /* pressed / active   */

  /* ── Text ───────────────────────────────────── */
  --color-text-primary:   #0f1115;
  --color-text-secondary: #475569;
  --color-text-tertiary:  #64748b;  /* Epic #702 — disabled labels, hints */

  /* ── Borders ────────────────────────────────── */
  --color-border:        #e2e8f0;
  --color-border-strong: #cbd5e1;  /* Epic #702 — emphasized dividers */

  /* ── Typography ─────────────────────────────── */
  --font-display: "Space Grotesk", system-ui, sans-serif;
  --font-body:    "Inter", system-ui, sans-serif;
  --font-mono:    ui-monospace, SFMono-Regular, Menlo, monospace;

  /* ── Radii (Epic #702) ──────────────────────── */
  --radius-sm:  6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 18px;
  --radius-2xl: 24px;

  /* ── Shadows (light, airy — Epic #702) ──────── */
  --shadow-xs: 0 1px 2px rgba(15,17,21,0.04);
  --shadow-sm: 0 1px 2px rgba(15,17,21,0.06), 0 1px 1px rgba(15,17,21,0.04);
  --shadow-md: 0 4px 16px rgba(15,17,21,0.06), 0 1px 2px rgba(15,17,21,0.04);
  --shadow-lg: 0 12px 40px rgba(15,17,21,0.08), 0 2px 6px rgba(15,17,21,0.04);
}
```

### 4.2 Global Body & Typography

```css
body {
  background-color: var(--color-surface-bg);
  color: var(--color-text-primary);
  font-family: var(--font-body);
}

h1, h2, h3, h4, h5, h6, .font-display {
  font-family: var(--font-display);
}
```

### 4.3 Card Component

```css
.card-surface {
  background-color: var(--color-surface-card);
  border: 1px solid var(--color-border);
  border-radius: 12px;
}
```

### 4.4 Tailwind Usage Quick Reference

```html
<!-- Page background -->
<div class="bg-surface-bg min-h-screen">

<!-- Card -->
<div class="bg-surface-card border border-border rounded-xl p-6 shadow-sm">
  <h3 class="text-text-primary font-display font-semibold">Card Title</h3>
  <p class="text-text-secondary text-sm">Supporting text</p>
</div>

<!-- Primary button -->
<button class="bg-brand hover:bg-brand-hover text-white font-semibold rounded-xl px-5 py-2.5 transition-colors">
  Get Started
</button>

<!-- Success badge -->
<span class="bg-action-lime/15 text-action-lime font-semibold text-xs px-2 py-0.5 rounded-full">
  Active
</span>
```

---

## 4.5 Empty-state copy conventions

Applies to the shared `EmptyState` primitive and dashboard widgets that render a zero-data state (`MiniProfileCard`, `TeamsWidget`, `ActionWidget`, `UnifiedFeed`, introduced in Epic #298).

* **Title** — Sentence case, one short line. Describe the absence in the user's own frame (e.g., "No teams yet", "Nothing in your feed yet"). Avoid negative framings like "Failed to load" unless the state is actually an error.
* **Description** — One sentence that explains *why* the surface is empty and hints at the next step. Keep under ~140 characters.
* **Call-to-action** — Every empty state should include a single primary CTA button that routes to the action that resolves the empty state (e.g., "Join a team", "Complete your profile"). Use sentence case for the button label. Omit the CTA only when there is no meaningful action the user can take.
* **Tone** — Active and empathetic. Avoid apologetic phrasing ("Sorry, …") and filler ("Looks like…"). Never blame the user.

---

## 5. Design Token Reference (`tokens.json`)

W3C-compatible summary for external design tooling:

```json
{
  "brand": {
    "primary": { "value": "#9333EA", "type": "color" },
    "dark":    { "value": "#6B21A8", "type": "color" },
    "hover":   { "value": "#7C22D0", "type": "color" }
  },
  "accent": {
    "cyan":    { "value": "#06B6D4", "type": "color" },
    "emerald": { "value": "#10B981", "type": "color" },
    "coral":   { "value": "#F43F5E", "type": "color" }
  },
  "surface": {
    "bg":     { "value": "#F8FAFC", "type": "color" },
    "card":   { "value": "#FFFFFF", "type": "color" },
    "hover":  { "value": "#F1F5F9", "type": "color" },
    "active": { "value": "#E2E8F0", "type": "color" }
  },
  "text": {
    "primary":   { "value": "#0F1115", "type": "color" },
    "secondary": { "value": "#475569", "type": "color" }
  },
  "border": { "value": "#E2E8F0", "type": "color" },
  "typography": {
    "display": { "value": "Space Grotesk, system-ui, sans-serif", "type": "fontFamily" },
    "body":    { "value": "Inter, system-ui, sans-serif", "type": "fontFamily" }
  }
}
```

---

## `data-testid` Conventions for Social Engagement (Epic #267)

All new interactive elements added by Epic #267 use the `section-element-action` convention for `data-testid`. When adding new components or extending these, follow the same scheme so existing E2E specs (`posts-management.spec.ts`, `comment-interactions.spec.ts`, `share-modal.spec.ts`, `shared-post-viewer.spec.ts`) continue to resolve:

| Component | Test IDs |
| --- | --- |
| `PostOptionsMenu.tsx` | `post-options-menu`, `post-options-edit`, `post-options-delete` |
| `PostEditorModal.tsx` | `post-editor-modal`, `post-editor-caption`, `post-editor-visibility`, `post-editor-tags`, `post-editor-save` |
| `DeleteConfirmationDialog.tsx` | `delete-confirm-dialog`, `delete-confirm-yes`, `delete-confirm-cancel` |
| `CommentThread.tsx` | `comment-thread`, `comment-reply-trigger` |
| `CommentReplyForm.tsx` | `comment-reply-form`, `comment-reply-input`, `comment-reply-submit` |
| `CommentLikeButton.tsx` | `comment-like-button`, `comment-like-count` |
| `ShareModal.tsx` | `share-modal`, `share-copy-button`, `share-password-input`, `share-save` |
| `SharedPostViewer.tsx` | `shared-post-viewer`, `share-unlock-input`, `share-unlock-button` |

**Rule**: Never delete or rename a `data-testid` without updating the corresponding spec file in `apps/web/e2e/` in the same commit.

## Profile Branding Surface (Epic #407)

Owners can personalize the public profile hero via:

* **Cover image** — a wide banner image above the profile header. Rendered with
  `aspect-ratio: 3 / 1` and a top-to-bottom gradient mask so the header card
  sits cleanly over the bottom third. URL is stored on `users.cover_image_url`.
* **Accent color** — a hex color applied to (a) the top-right glow blob in the
  profile header and (b) a tinted border on the header card. Fallback is the
  brand gradient. Stored on `users.accent_color`, validated as `#RGB` / `#RRGGBB`.
* **Signature stat** — an `users.signature_stat_key` pointer into the athlete's
  verified stats collection. Surfaced in the public response; UI treatment
  (highlighted stat / sport-scoped filter) is deferred to a future sprint
  (ADR-056).
* **Featured reel** — owner-pinned highlight rendered as a Mux iframe player in
  the main column. Pin is stored on `users.featured_highlight_id`; dangling ids
  silently degrade to null (no crash).
* **Verified badge** — rendered when any of the athlete's rosters carries
  `isVerified = 1`. The badge uses emerald `bg-emerald-500/10 text-emerald-300`
  tokens and sits inline with the "Athlete Profile" kicker.

Copy remains sentence-case (`Featured reel`, not `Featured Reel`). The cover
banner should not duplicate the athlete's name — the header card below already
displays it.

## Profile upload error messages (Epic #438)

The cover photo and avatar uploaders surface server-side validation failures
verbatim. Each message follows the rules/ui-copywriting pattern (what / why /
how to fix), uses sentence case, and never blames the user. Use these as the
canonical examples when introducing new upload error codes:

| `error.code`        | User-facing message                                                                                  |
| :------------------ | :--------------------------------------------------------------------------------------------------- |
| `INVALID_FILE_TYPE` | We couldn't upload that file because only JPEG, PNG, or WebP images are supported. Try a different image. |
| `FILE_TOO_LARGE`    | That image is larger than the 5 MB limit for cover photos (3 MB for avatars). Try compressing it or pick a smaller file. |
| `IMAGE_TOO_SMALL`   | That image is too small. Cover photos need to be at least 1200×400, and avatars at least 256×256.    |
| `SLUG_TAKEN`        | That profile URL is already in use. Try another one — a–z, 0–9, and hyphens, 3–40 characters.        |

## Profile form styling (Epic #469)

All profile tab forms import `inputCls` and `labelCls` from
`apps/web/src/components/profile/formStyles.ts`. Do not define ad-hoc input or
label classes in individual tabs. The shared module ensures consistent
`focus-visible:ring-2 focus-visible:ring-brand/50` focus indicators, surface
card backgrounds, and text sizing across all profile forms.

## Micro-animations (Epic #469)

Profile interactions use subtle animations for a premium feel:

* **Tab switching**: 150ms opacity + translateY fade-in via `requestAnimationFrame`
  in the Astro island script.
* **ComboboxMulti chips**: `chip-in` scale-in keyframe on add, scale-out + fade
  on remove (100ms `ease-out`).
* **Save pulse**: `success-pulse` ring animation (600ms) triggered via
  `useSavePulse` hook after successful form saves.

All animations are defined in `apps/web/src/styles/global.css` and referenced via
Tailwind `animate-[...]` arbitrary values.

## Calendar & event chip styling (Epic #466)

Event chips use the soft translucent pill pattern: 20 % opacity fill, 200-shade
text, 40 % opacity border. Colors are assigned by `event_type` in
`apps/web/src/components/calendar/eventColors.ts` — `game` rose, `practice`
sky, `training` emerald, `academic` amber, `college_visit` violet, `combine`
orange, `tryout` lime, `meeting` slate, `other` zinc. Do not override these in
page-level CSS; extend the shared map when a new `event_type` is added.

Team-authored events render an outer ring keyed by a deterministic hash of the
`team_id` (`teamAccentRing()` in the same module), giving each team a stable
accent color across the grid without a lookup table. Personal events omit the
ring (`ring-transparent`).

Conflict indicators (the org-calendar overlay badge and the per-event conflict
list) use the Alert Coral token: `bg-alert-coral/15 text-alert-coral`.
Conflict counts use the same soft-badge pattern as RSVP counts so the two
indicator systems read as one visual family.

### EventChip composite — Epic #702 extension

The `EventChip` composite at
[`apps/web/src/components/ui/EventChip.astro`](../apps/web/src/components/ui/EventChip.astro)
is the canonical surface for rendering a single event on the calendar
or agenda. The colour decisions for every event_type live in the
canonical map at
[`apps/web/src/components/ui/_lib/eventColors.ts`](../apps/web/src/components/ui/_lib/eventColors.ts)
(`EVENT_COLORS`), exported as a frozen record so consumers cannot
re-derive the palette per call-site.

**Canonical `event_type` set.** The base set above (`game`, `practice`,
`training`, `academic`, `meeting`, `other`) is extended by Epic #702
with one new type:

| `event_type` | Colour family | Notes |
| :----------- | :------------ | :---- |
| `tournament` | Violet (rgb(139 92 246)) | Multi-day brackets, league championship surfaces |

`tournament` reuses the soft-pill formula (20 % opacity fill,
200-shade text, 40 % opacity border). Adding a new `event_type`
requires extending **both** the `EventType` union and the
`EVENT_COLORS` record in the same PR — `resolveEventColor` throws
`TypeError` on an unmapped value so an unmapped chip is a loud
authoring error rather than a silently misrendered one.

**Inset 3 px ring stripe.** Every chip carries an inset 3 px stripe
along its leading edge, keyed to the same colour as the chip text.
This is composed via an inline `box-shadow: inset 3px 0 0 <color>` —
it is intentionally inset (not a border) so the chip's outer radius
stays flush with the calendar grid. Do not replace the stripe with a
left border in a consuming Epic.

**6 px conflict dot.** When a chip has scheduling conflicts it renders
a 6 px Alert-Coral dot anchored to its top-right corner. The colour is
sourced from `CONFLICT_DOT_COLOR` (`var(--color-action-coral)`) so the
dot reads as part of the same indicator system as the calendar's
conflict overlay badge. The dot carries `role="img"` +
`aria-label="Scheduling conflict"` so screen readers surface it.

## Vanity profile branding color

The `branding_color` field on the profile is a hex string (`#RRGGBB`) sanitised
server-side, then exposed to the public profile shell at `/p/[slug]` as a
scoped CSS custom property — never inlined as raw `style="color:..."`. Author
new branding-aware components against this variable so unsanitised values can
never reach the DOM:

```css
.profile-shell {
  --profile-brand: var(--user-branding-color, var(--color-brand));
}
```

## Public discovery surface (Epic #467)

The `/explore` shell uses a single light-on-surface card grid for both list
and grid views — the toggle changes density (1-up vs 3-up), not chrome. Filter
chips above the grid use the established muted-pill pattern (`bg-muted/40`
plus accent on active). The map view shares the same filter strip; the map
canvas occupies the right column on desktop and a full-bleed sheet on
mobile.

**Map clusters** use the platform accent (`text-brand`) with size scaling by
member count. Single-pin popups follow the existing card popover style — no
custom shadow stack — so they read as part of the discovery family.

**Empty states** on `/explore` use the shared `EmptyState` component with copy
that names the active filters: e.g. "No tournaments match U-12 boys' soccer
in March. Try expanding the date range." This is the canonical pattern for
filterable public surfaces.

**Tournament detail status badge** (`TournamentStatusBadge.tsx`) maps four
states — `Upcoming`, `Registration open`, `In progress`, `Completed` — to the
existing semantic chip palette (Brand, Grass, Sun, Slate respectively). Use
sentence-case ("Registration open"), not title-case.

**Registration confirmation** (`TournamentRegistrationConfirmation.tsx`) uses
the platform's success Sun-tinted card with the team name, division, and a
calendar add-to button — no novel surface treatment.

## Epic #574 — no UI or copy changes (2026-04-20)

Epic D shipped test-infrastructure work only (BDD/Gherkin migration, CI sharding, step-definition linter, test-surface freeze, flake budget). It introduced **zero** changes to user-facing surfaces, components, copy, casing, or tone — this style guide is unchanged.

## Epic #534 — College Recruiting Foundation (2026-04-21)

Epic #534 shipped new surfaces (`/colleges/[slug]`, `/recruiting/colleges`, mobile `CollegesScreen`, Recruiting Preferences section) but introduced **no new casing, tone, or typography rules**. All new copy follows the existing sentence-case conventions for titles, buttons, and filter chips ("Save college", "Within 200 miles", "D2 matches your target level"); empty-state and error messages follow the three-part template in [`.agents/rules/ui-copywriting.md`](../.agents/rules/ui-copywriting.md#error-messages). Templated explanation fragments in the recommender (see [ADR-063](decisions.md#adr-063-deterministic-explainable-athlete--college-recommender-scoring)) are authored as single-sentence, active-voice strings — no trailing period inside the fragment, one period between fragments when concatenated. No additions to the color palette or event-type color map. This style guide is otherwise unchanged.

## Epic #97 — User Education, Support & Updates (2026-04-21)

Epic #97 shipped the Help Center surfaces (`/help`, `/help/articles/[slug]`, `/help/contact`, `/help/tickets`, `/help/tickets/[id]`) and the admin triage dashboard at `/admin/support`. (`/help/tutorials` and `/whats-new` were removed in the 2026-05-09 MVP scope cut.) All copy holds to the existing sentence-case conventions for headings, buttons, and status chips ("Contact support", "Submit ticket", "Send reply", "My tickets", "Move to In progress"). User-facing error and success messages follow the three-part template in [`.agents/rules/ui-copywriting.md`](../.agents/rules/ui-copywriting.md#error-messages) — "We couldn't submit your ticket because… Please…". Ticket status labels are authored once as `STATUS_LABELS` (`New`, `In progress`, `Awaiting your reply`, `Resolved`, `Closed`) and reused across the user and admin surfaces; do not fork them. The PII-warning banner on `/help/contact` uses sentence-case advisory copy ("Heads up: we noticed your message may contain …") rather than danger-tinted alert styling, because the ticket still submits — warning ≠ error. No additions to the color palette; the admin dashboard reuses existing `surface-card` / `surface-bg` / `brand` tokens exclusively. This style guide is otherwise unchanged.

## Epic #749 — no style changes (2026-04-22)

Epic #749 stood up BDD acceptance-tier mutation testing (Stryker + playwright-bdd, nightly `bdd-mutation.yml` workflow with rotating per-run scopes). It shipped test-infrastructure and CI changes only — no new user-facing surfaces, no new copy, no new typography or color tokens. This style guide is unchanged.

## Epic #750 — no style changes (2026-04-24)

Epic #750 closed web↔mobile parity gaps, stood up the Detox + Jest binder on the shared `tests/features/**` corpus, introduced the mobile step library under `apps/mobile/e2e/steps/**`, added the cross-runner parity checker, and promoted the mobile CI matrix to required checks. Mobile screens that were filled in or wired into navigation (e.g. `ModerationQueue` into the drawer, `NotificationsScreen`, `SidelineMode`) reuse existing tokens, sentence-case headings/buttons, and the three-part error-message template already defined by this guide and [`.agents/rules/ui-copywriting.md`](../.agents/rules/ui-copywriting.md). **Zero** new typography, colour, casing, or tone rules were introduced. This style guide is unchanged.

## Epic #751 — no style changes (2026-04-28)

Epic #751 was a discovery-only production-readiness audit pass plus an in-Epic remediation tail (auth correctness #894, dependency CVE backlog + `pnpm audit` gate #895, CI gate integrity #896, performance hot fixes #897 across web islands / GeoJSON memoisation / API edge cache headers / mobile push deferral, accessibility + lint sweeps, structural 0/0 lint baseline floor #872). The accessibility sweeps (label↔control association, keyboard parity for cards/dialog backdrops, combobox `aria-*` + media-track + tooltip `role`) added missing `htmlFor`/`id` plumbing and replaced `autoFocus` with refs but did not change visible copy, casing, typography, colour tokens, or component styling. The UX/UI audit findings that are user-facing land in downstream Epics (#753 analytics, #755 legal & compliance, #756 support tooling). **Zero** new typography, colour, casing, or tone rules were introduced in this Epic. This style guide is unchanged.

## Epic #752 — no style changes (2026-05-02)

Epic #752 stood up the MVP beta observability stack — Sentry, Cloudflare Workers Analytics Engine + Logpush, Better Stack probes, the operator runbook at [`docs/ops/runbook.md`](./ops/runbook.md), and [ADR-068](./decisions.md#adr-068-observability-vendor-stack-for-the-mvp-beta). The only user-facing copy added is the `apps/web/src/components/SentryBoundary.tsx` fallback message, which already conforms to this guide's tone rules and the three-part error-message template at [`.agents/rules/ui-copywriting.md`](../.agents/rules/ui-copywriting.md). All other artefacts are operator-facing runbook / ADR / contract-test text governed by [`.agents/rules/changelog-style.md`](../.agents/rules/changelog-style.md), not by this style guide. **Zero** new typography, colour, casing, or tone rules were introduced. This style guide is unchanged.

## Epic #961 — no style changes (2026-05-09)

Epic #961 shipped CI/CD pipeline + quality-baseline work only — no new user-facing surfaces, no new copy, no new typography, colour, or tone rules. **Zero** changes to this style guide.
