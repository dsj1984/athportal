# ADR-0007 — UI styling convention: Tailwind-utility-first, primitives over BEM

**Status**: Accepted (2026-05-25, Story #834). Supersedes the implicit
convention left in place by Epic #702 (Design system foundation), which
shipped the primitive library and the `@theme` token catalogue in
[`apps/web/src/styles/global.css`](../../apps/web/src/styles/global.css)
but did not codify a written rule against orphan BEM class hooks. The
absence of that rule allowed `EmptyState.astro` to land with
`.empty-state__title` / `.empty-state__body` / `.empty-state__cta` class
names that no stylesheet defined — markup that *looked* like a design
system contract but had no styling behind it. This ADR closes that gap.

## Context

Epic #702 (Design system, Stories #711–#723) delivered the foundation:
a Tailwind v4 `@theme` token block in
[`apps/web/src/styles/global.css`](../../apps/web/src/styles/global.css),
~14 primitives under `apps/web/src/components/ui/` (`Btn`, `Card`,
`EmptyState`, `Shell`, `Topbar`, etc.), and the `cva`-based variant
shaping pattern documented in
[`docs/patterns.md` § *Primitive library*](../patterns.md#primitive-library).
The component conventions emerged in PR review (Tailwind utilities on the
root JSX/Astro element, variant resolution via `cva` or a colocated
`buildXxxView` builder, colocated `<style>` only for layout
primitives that compose grid/flex), but no document declared them as
binding.

The cost of the missing rule surfaced when
[`apps/web/src/components/ui/EmptyState.astro`](../../apps/web/src/components/ui/EmptyState.astro)
was discovered to carry orphan BEM class names — `empty-state`,
`empty-state__title`, `empty-state__body`, `empty-state__cta` — with no
matching CSS in `global.css`, no colocated `<style>` block in the
component, and no `cva` variants resolving them. The classes rendered
to the DOM, but they styled nothing. The primitive worked only because
its parent layouts happened to constrain the surface and the unstyled
text was readable on the default `--color-text-primary` body color.

Two reviewer questions made the gap explicit:

1. *Is BEM the convention here?* No — the rest of the primitive library
   uses Tailwind utility classes on a single root element, sometimes
   composed through `cn` and `cva`. `EmptyState.astro` was the only
   primitive emitting BEM-shaped class names.
2. *Is the BEM markup styled somewhere I'm missing?* No — the class
   names had no resolver. They were aspirational hooks left over from a
   draft that intended to ship a separate stylesheet.

Without a written convention, the lint that would have caught the orphan
hooks at PR time could not exist either: there was no rule to mechanize.

## Decision

The platform's UI styling convention is:

### 1. Tailwind-utility-first

Every component in `apps/web/src/components/ui/**` and
`apps/web/src/pages/**` styles its rendered markup with Tailwind v4
utility classes resolved against the `@theme` token catalogue in
[`apps/web/src/styles/global.css`](../../apps/web/src/styles/global.css)
(`bg-surface-card`, `text-text-secondary`, `rounded-xl`, `shadow-sm`,
`border-border`, etc.). Tailwind utilities are the **default authoring
surface** for spacing, color, typography, radii, shadows, and layout.

### 2. Primitives over BEM

Where two or more pages need the same shape, extract a primitive in
`apps/web/src/components/ui/<Name>.astro` (with a sibling
`<Name>.ts` builder for variant shaping when needed). The primitive
owns the Tailwind utility string; consumers compose primitives. Do not
hand-author BEM-shaped class names (`block__element` or
`block--modifier`) to identify component parts — `cva` variants and
slot composition replace that role.

### 3. Colocated `<style>` only for layout primitives

A colocated `<style>` block inside an `.astro` file is permitted *only*
for layout primitives that compose grid or flex behavior the
Tailwind utility surface cannot express cleanly (e.g. a multi-row CSS
grid template with named tracks). When such a `<style>` block exists,
its class names MUST be scoped to the component file and MUST be
referenced by the same file's markup. They are not part of any public
class-name contract.

### 4. No orphan BEM hooks

A class name matching `[\w-]+__[\w-]+` (BEM block-element) or
`[\w-]+--[\w-]+` (BEM modifier) inside an `apps/web/src/**` `.astro`
or `.tsx` file MUST resolve to one of:

* a class rule in a colocated `<style>` block in the same file (per
  rule 3 above), or
* a class rule defined in
  [`apps/web/src/styles/global.css`](../../apps/web/src/styles/global.css),
  or
* a `cva` variant declared in an imported primitive's `.ts`
  builder.

A class name that matches the BEM regex but does not resolve to one of
the three sources above is an **orphan BEM hook** and is forbidden.
Orphan hooks are the failure mode this ADR exists to prevent: markup
that promises a styling contract the codebase does not fulfill.

### 5. Mechanized enforcement

Rule 4 is enforced by `scripts/lint-orphan-bem.mjs`, wired into the
[`quality.yml`](../../.github/workflows/quality.yml) workflow as the
`lint-orphan-bem` job (a required-status check on every PR) and into
[`.husky/pre-push`](../../.husky/pre-push) as part of the fail-fast
local chain. The script walks `apps/web/src/`, extracts every BEM-shaped
class name from `class="…"` attributes in `.astro` and `.tsx` files, and
fails non-zero with a per-file/line report if any unresolved name is
found.

## Acceptance copy

The convention applies uniformly to:

* Every existing `apps/web/src/components/ui/**` primitive — Story #834
  / Task #839 brings `EmptyState.astro` into compliance by replacing its
  orphan BEM classes with Tailwind utilities resolved against
  `@theme` tokens.
* Every feature-area page under `apps/web/src/pages/**` and every shared
  layout under `apps/web/src/components/**`. Pages that consume
  primitives inherit the primitive's styling contract — they do not
  reach inside with BEM-shaped selectors.
* New primitives added by future Stories — the same lint runs on every
  PR.

The convention does **not** apply to:

* The Tailwind v4 `@theme` block itself (it declares tokens, not class
  names).
* Files generated by tooling (Astro build output, BDD-generated test
  files, coverage reports). The lint script excludes anything outside
  `apps/web/src/`.
* External libraries' CSS shipped through dependencies — the convention
  is about authored code in this repo.

## Rejected alternatives

**Rejected — keep BEM as a parallel convention.** A two-track styling
system (utilities + BEM) requires every reviewer and every contributor
to know which surfaces use which track, and produces the exact
ambiguity that allowed the `EmptyState.astro` orphans to ship. Tailwind
utilities already cover every concern BEM was carrying here (spacing,
color, typography, layout) via the `@theme` tokens; a second
class-name DSL is dead weight.

**Rejected — allow orphan BEM hooks as "future-proofing" markup
contracts.** Aspirational hooks are indistinguishable from dead code at
read time and from styling bugs at render time. If a future stylesheet
needs a contract, the right time to add the hook is the same PR that
adds the matching CSS rule.

**Rejected — enforce the rule via review only.** Review caught the
`EmptyState.astro` orphans eventually, but only after they landed on
`main` and only when a reviewer happened to grep for the class names.
A mechanical lint with a per-file/line report is cheaper than the
recurring review cost.

## Consequences

* Contributors author component styling with Tailwind utilities by
  default. The `@theme` block in `global.css` is the SSOT for tokens;
  utilities resolve against it automatically.
* New primitives ship a `.astro` file (markup with utility classes), a
  `.ts` builder (variant shaping with `cva` when needed), and a
  `.test.ts` (unit coverage of the builder). No new `.css` files are
  added except via an explicit follow-on ADR.
* Reviewers no longer have to grep for orphan BEM hooks — the lint
  catches them. A PR that adds an orphan BEM class fails CI with a
  per-file/line error.
* The
  [`docs/style-guide.md`](../style-guide.md) live-page rule (the
  `/internal/styleguide` route is canonical when this document and the
  live page disagree) is unchanged. This ADR adds the authoring rule
  the live page demonstrates but never previously declared in prose.
* Future deviations (a primitive that genuinely needs hand-authored
  CSS) require a follow-on ADR that explicitly carves out the
  exception. The lint script's resolver set (colocated `<style>`,
  `global.css`, `cva` variants) is the only authorized surface for
  resolving BEM-shaped class names.

## Cross-references

* [`docs/style-guide.md`](../style-guide.md) — the platform's visual
  identity reference; the live `/internal/styleguide` page remains
  canonical when prose and the page disagree.
* [`docs/patterns.md` § *Primitive library*](../patterns.md#primitive-library)
  — the import-this-not-Tailwind contributor rule for consumers of
  primitives.
* [`apps/web/src/styles/global.css`](../../apps/web/src/styles/global.css)
  — the `@theme` token catalogue Tailwind utilities resolve against.
* [`scripts/lint-orphan-bem.mjs`](../../scripts/lint-orphan-bem.mjs) —
  the mechanical enforcement of rule 4 (Story #834 / Task #838).
* [`.github/workflows/quality.yml`](../../.github/workflows/quality.yml)
  — the CI workflow that runs `lint-orphan-bem` on every PR (Story
  #834 / Task #840).
