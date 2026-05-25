# Design explorations

Point-in-time UI design snapshots imported from
[claude.ai/design](https://claude.ai/design) or other exploration tools.
Retained as **directional, non-binding** reference for downstream UI
Epics.

## The canonical / exploration boundary

| Surface | Lives at | Owns |
|---|---|---|
| Brand voice + rules | [`docs/style-guide.md`](../style-guide.md) | Tone, casing, copy, ratified Epic amendments |
| Tokens | [`apps/web/src/styles/global.css`](../../apps/web/src/styles/global.css) | Colours, radii, shadows, type, mono stack |
| Primitives | [`apps/web/src/components/ui/`](../../apps/web/src/components/ui/) | `Btn`, `Badge`, `Input`, `EventChip`, `Shell`, etc. |
| Live primitive reference | `/internal/styleguide` | Renders every primitive against real tokens (run `pnpm --filter @repo/web dev`) |
| Contributor rules | [`docs/patterns.md`](../patterns.md) § Primitive library | Import-this-not-Tailwind-classes, no per-Epic restyling |
| **This folder** | `docs/design-explorations/` | Visual exploration only — does not constrain implementation |

When an exploration here disagrees with one of the canonical sources
above, **the canonical source wins**.

## Folder layout

Each handoff lands as a timestamped sibling directory and never
overwrites a prior one. The historical inspiration is part of the
design archaeology.

```text
docs/design-explorations/
  README.md                 ← this file
  2026-05-handoff/          ← first Claude Design handoff (Epic #702 seed)
    README.md               ← handoff-specific status + artboard → Epic map
    project/                ← original bundle contents
```

## How an Epic PRD references a handoff

The recommended PRD section:

```markdown
## Design references

- **Mockup**: [`docs/design-explorations/<date>-handoff/project/screens-<area>.jsx`](…) — `<Artboard/>`
- **Primitives reused as-is**: Btn, Badge, EventChip, Stat, Ring, …
- **Net-new primitives implied**: `<HeroBanner>` — decision: build inline this Epic, candidate for primitive package follow-up if reused
- **Intentional divergence from mockup**:
  - …
```

This makes mockup-vs-canonical drift explicit at planning time, so the
contributor never has to guess which is authoritative.

## Sunset triggers

A mockup file gets a leading `// SUPERSEDED <date> by <real path> (Epic #N / PR #M)` annotation when a real implementation overtakes it. Files
are **annotated, not deleted** — the historical context is the value of
keeping the bundle around. When a new handoff iteration lands, drop it
next to the prior one as `docs/design-explorations/<new-date>-handoff/`
— never overwrite.
