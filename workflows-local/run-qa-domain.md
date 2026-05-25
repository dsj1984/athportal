---
description: >-
  Drive every plan and charter under tests/{plans,charters}/<domain>/ via
  /run-qa, then emit a per-domain summary grouping plans (pass/fail) and
  charters (findings).
---

# /run-qa-domain `<domain>`

`/run-qa-domain` is the **per-domain aggregator** for the QA corpus. It
reads `tests/qa-index.json`, selects every artifact whose `domain` field
matches the `<domain>` argument, and invokes [`/run-qa`](./run-qa.md) once
per artifact. The runner does **not** re-implement the per-artifact
dispatch — it delegates to `/run-qa` and aggregates the results into a
single domain-level summary.

**Argument:** the domain string exactly as it appears in `qa-index.json`
(e.g. `identity`, `org-admin`, `design-system`).

The aggregator inherits every per-artifact safety constraint from
`/run-qa` — including the charter safety gate that refuses to drive a
non-local environment without `--allow-non-local`. Refusals are rolled up
as `skipped — non-local environment` rows in the summary; they do **not**
abort the whole domain run.

> **Citation:** Tech Spec [#782](https://github.com/dsj1984/athportal/issues/782) § Runner topology + § Core Components #5;
> PRD [#781](https://github.com/dsj1984/athportal/issues/781) AC-5;
> Acceptance Spec [#783](https://github.com/dsj1984/athportal/issues/783) AC-10.

---

## 1. Resolve `<domain>` against the index

1. Read `tests/qa-index.json` from the repo root.
2. If the file is **missing**, exit immediately with this message and do
   not invoke `/run-qa`:

   ```text
   /run-qa-domain: tests/qa-index.json is missing. Generate it with:
       pnpm run index:qa
   then re-invoke /run-qa-domain <domain>.
   ```

3. Filter the index to entries where `entry.domain === <domain>`.
4. If the filtered set is **empty**, exit with a friendly message and do
   not invoke `/run-qa`:

   ```text
   /run-qa-domain: no artifacts found under tests/{plans,charters}/<domain>/.
   Available domains in tests/qa-index.json:
       <comma-separated list of unique domain values>
   ```

5. Sort the filtered set alphabetically by `id` so the run order is
   deterministic and reproducible across operators.

## 2. Announce the dispatch

Before invoking the first `/run-qa`, print a one-block summary so the
operator can confirm scope:

```text
/run-qa-domain dispatch
  domain:    <domain>
  artifacts: <n> (<p> plan(s), <c> charter(s))
  order:     <id-1>, <id-2>, ..., <id-n>
```

The aggregator does **not** require explicit confirmation at the domain
level — the per-artifact safety gates already protect destructive
surfaces. See `/run-qa-all` for the corpus-wide confirmation gate.

## 3. Drive each artifact via `/run-qa`

For each artifact in the sorted set, in order:

1. Invoke `/run-qa <id>` (single artifact). The per-artifact prerequisite
   and safety gates inside `/run-qa` run unchanged.
2. Capture the dispatched result:
   - For **plans**, collect the pass/fail table tally — total Steps,
     PASS count, FAIL count, DEPENDENT-FAIL count, and the artifact's
     `persona` from the front-matter.
   - For **charters**, collect the heuristics applied, the count of
     `## Findings` rows appended during this run, and whether the
     `TIME-BOX REACHED` note was written.
3. If `/run-qa` refused to start (most commonly: charter safety gate, or
   plan prerequisite unmet), record a `skipped` row with the verbatim
   refusal reason and continue to the next artifact. A single skip does
   **not** abort the domain run.

The aggregator passes through `/run-qa`'s flags transparently — if the
operator invokes `/run-qa-domain identity --allow-non-local`, each
charter's `/run-qa` invocation receives that flag.

## 4. Emit two summary tables

After the last artifact completes, print two tables — one for plans, one
for charters — followed by a one-line domain tally. Omit a table when
the domain has no artifacts of that kind.

### Plans table

```text
| id | persona | steps total | steps passed | status |
```

- `status` is one of `PASS` (every Step PASSed), `FAIL` (at least one
  Step FAILed or DEPENDENT-FAILed), or `skipped — <reason>` (prerequisite
  unmet, dispatch refused, …).
- `steps total` and `steps passed` come from the plan run's pass/fail
  tally; for skipped rows they are `—`.

### Charters table

```text
| id | heuristics applied | findings added | time-boxed? | status |
```

- `heuristics applied` is the count of heuristic names the run actually
  drove (not the count declared in front-matter — declared heuristics
  that fail to load become a skipped heuristic, not an applied one).
- `findings added` is the count of new rows the run appended to the
  artifact's `## Findings` table.
- `time-boxed?` is `yes` when `TIME-BOX REACHED` was written to
  `## Notes`, otherwise `no`.
- `status` is one of `completed`, `time-boxed`, or
  `skipped — non-local environment` (or another verbatim refusal
  reason from the per-artifact safety gate).

### Domain tally

End with one summary line:

```text
<domain>: <plans-passed>/<plans-total> plans passed,
<charter-findings-added> finding(s) added across <charters-completed>/<charters-total> charters,
<n> skipped.
```

## 5. Persistence contract (inherited from `/run-qa`)

- The aggregator does **not** modify the corpus directly. All file
  mutations happen inside the per-artifact `/run-qa` runs (charter
  Findings + Notes appends).
- The aggregator does **not** auto-commit. The operator decides whether
  to keep the appended rows after reviewing the summary tables.
- The aggregator does **not** push and does **not** open a PR.
