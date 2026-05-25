# landmark-tour

A coverage heuristic: walk every named landmark on a page (headings,
navigation regions, primary buttons, footer) and confirm each one is
labeled, focusable in keyboard order, and consistent with the page's
declared route. Catches drift between the design system and the page
implementation that escapes the visual eye.

## When to apply

Apply at the start of a charter session against a new or recently-
modified page, and on every page under
`apps/web/src/pages/internal/styleguide` when a design-system change
ships. Pair with screen-reader output and tab-order keyboard navigation
so landmark drift surfaces alongside missing labels.

## How to apply

Open the page and enumerate every ARIA landmark via the browser
accessibility tree (the `take_snapshot` MCP tool exposes the same data).
Walk the landmarks top-to-bottom: `banner`, `navigation`, `main`,
`complementary`, `contentinfo`. For each: (1) confirm it has a unique,
human-readable label; (2) tab to it with the keyboard and confirm the
focus ring is visible; (3) confirm the heading hierarchy inside the
landmark is monotonic (no `h3` directly under `h1`). For pages under
`apps/web/src/pages/admin/*`, additionally confirm the breadcrumb
landmark matches the route prefix and that the sign-out control is
reachable from every page. Cross-check page-level landmarks against
the `docs/web-routes.md` declared route to catch routes whose UI shell
diverged from the design.

## Signals of a finding

- A landmark exists in the DOM but has no accessible name.
- Two landmarks share the same label.
- Tab order skips a landmark or revisits one twice.
- The breadcrumb landmark says one route while the address bar shows
  another.
- A heading inside `main` is `h3` or lower without an intermediate `h2`.
- A focusable element exists outside any landmark.
