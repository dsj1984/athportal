<!-- Story #894 Task #900 — Drive /run-qa-domain design-system to green -->
<!-- Generated 2026-05-26 by attempt 3 (chrome-devtools MCP runner). -->

# Run log — design-system domain (SMOKE ONLY)

Runner: chrome-devtools MCP via `/story-deliver 894` (attempt 3).
Stack: local dev (`pnpm dev` on `http://localhost:4321`) at
post-hotfix `epic/869 @ 3e0f912`.

## Per-plan disposition (SMOKE ONLY — not plan-runner PASS)

| Plan id                                    | Status | Honest evidence                                                                                                                                                                                                                                                                                                                                  |
| :----------------------------------------- | :----: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tp-design-system-styleguide-walkthrough`  | YELLOW | `/internal/styleguide` is gated to `role = 'dev_admin'`. Unauthenticated `curl` returns 302 → `/` (gate fires correctly). None of the QA personas in `clerk-personas.json` hold `dev_admin`; only the operator's own Clerk account does (via `scripts/seed-dev-admin.mjs`). Operator-owned per PRD #870 AC-7 — plan stays in the corpus and the operator walks it locally after promoting their account. The 7 per-step Expected predicates (Foundations / Interactive atoms / Display atoms / Composites / Primitives / keyboard-focus) were NOT walked in this pass. |

## Tally

0 plan-runner PASS · 0 SMOKE-PASS · 0 NOT-DRIVEN · 1 YELLOW out of 1 plan.

## Notes

The 7-step styleguide walkthrough is intrinsically a `dev_admin`-only
journey (the `/internal/*` surface ships hidden via
`X-Robots-Tag: noindex, nofollow` plus the role gate). Adding
`dev_admin` to the persona-bootstrap runbook would let the agent
runner drive this plan headlessly; that is recommended as a follow-up
against Story #881's runbook, not a fix scoped to this Story.
