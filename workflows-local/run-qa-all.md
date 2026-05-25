---
description: >-
  Drive every plan and charter in the QA corpus via /run-qa, sequentially.
  Long-running by design — requires explicit operator confirmation before
  dispatch and reports a per-domain summary at the end.
---

# /run-qa-all

`/run-qa-all` is the **corpus-wide aggregator** for the QA corpus. It
reads `tests/qa-index.json`, prints an honest runtime estimate, requires
the operator to confirm the dispatch verbatim, and then invokes
[`/run-qa`](./run-qa.md) once per artifact across every domain. The
runner emits a domain-grouped summary at the end.

**No argument.** `/run-qa-all` always dispatches the full corpus —
filtered or per-domain runs belong to
[`/run-qa-domain`](./run-qa-domain.md).

The aggregator inherits every per-artifact safety constraint from
`/run-qa` — including the charter safety gate that refuses to drive a
non-local environment without `--allow-non-local`. Refusals are rolled up
as `skipped — non-local environment` rows in the summary; they do **not**
abort the corpus run.

> **Citation:** Tech Spec [#782](https://github.com/dsj1984/athportal/issues/782) § Runner topology + § Core Components #5;
> PRD [#781](https://github.com/dsj1984/athportal/issues/781) AC-5;
> Acceptance Spec [#783](https://github.com/dsj1984/athportal/issues/783) AC-10.

---

## 1. Load the corpus

1. Read `tests/qa-index.json` from the repo root.
2. If the file is **missing**, exit immediately with this message and do
   not invoke `/run-qa`:

   ```text
   /run-qa-all: tests/qa-index.json is missing. Generate it with:
       pnpm run index:qa
   then re-invoke /run-qa-all.
   ```

3. If the index is **empty** (no entries), exit with:

   ```text
   /run-qa-all: tests/qa-index.json contains no artifacts. Nothing to run.
   ```

4. Sort the corpus alphabetically by `id` so the run order is
   deterministic and reproducible across operators.

## 2. Compute the runtime estimate

The estimate is the honest sum of declared per-artifact budgets — it
does **not** model setup, navigation, or snapshot overhead, so real
walltime will exceed the estimate. Print the estimate explicitly so the
operator can decide whether to opt in.

1. For each plan entry, take `entry.est_minutes` (default to `0` when
   the field is absent).
2. For each charter entry, take `entry.time_box_minutes` (default to
   `0` when the field is absent).
3. Sum them. Round **up** to the nearest whole minute.
4. Tally the unique domains involved and the per-domain artifact counts.

## 3. Confirmation gate (MANDATORY)

Print this block verbatim — fill in the placeholders — and **wait for
an explicit operator reply** before invoking `/run-qa`:

```text
/run-qa-all dispatch — confirmation required
  artifacts:     <n> total (<p> plan(s), <c> charter(s))
  domains:       <comma-separated unique domain values, alphabetical>
  per-domain:    <domain-1>: <count>, <domain-2>: <count>, ...
  runtime estimate: <minutes> minute(s)
    (sum of est_minutes for plans + time_box_minutes for charters,
     rounded up. Real walltime will exceed this — setup, navigation,
     and snapshot overhead are not modelled.)

This will drive every artifact in the corpus sequentially. The
per-artifact /run-qa safety gates still apply (charters targeting a
non-local environment will be skipped unless --allow-non-local is in
effect).

To proceed, the operator MUST reply 'CONFIRM' verbatim. Any other
response — including silence — aborts the dispatch.
```

**Resume contract.** Only continue past this gate when the operator
sends the literal string `CONFIRM`. Anything else (a blank reply, a
nuance like `confirm`, `yes`, `go`, a clarifying question, …) is
treated as an abort: print

```text
/run-qa-all: aborted — operator did not reply 'CONFIRM' verbatim.
```

and stop. Do not invoke `/run-qa`. Do not re-prompt.

## 4. Drive each artifact via `/run-qa`

After `CONFIRM`, iterate the sorted corpus in order. For each artifact:

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
   **not** abort the corpus run.

The aggregator passes through `/run-qa`'s flags transparently — if the
operator invokes `/run-qa-all --allow-non-local`, each charter's
`/run-qa` invocation receives that flag.

## 5. Emit the corpus-level summary

Group results by domain. For each domain (in alphabetical order), print
the same two tables `/run-qa-domain` emits — plans then charters — under
a `## <domain>` heading. Omit a table when the domain has no artifacts
of that kind.

### Plans table (per domain)

```text
| id | persona | steps total | steps passed | status |
```

### Charters table (per domain)

```text
| id | heuristics applied | findings added | time-boxed? | status |
```

(Field rules are identical to `/run-qa-domain` § 4. See that workflow
for the canonical column definitions.)

### Corpus tally

End with one summary line:

```text
corpus: <plans-passed>/<plans-total> plans passed,
<charter-findings-added> finding(s) added across <charters-completed>/<charters-total> charters,
<n> skipped across <d> domain(s).
```

## 6. Persistence contract (inherited from `/run-qa`)

- The aggregator does **not** modify the corpus directly. All file
  mutations happen inside the per-artifact `/run-qa` runs (charter
  Findings + Notes appends).
- The aggregator does **not** auto-commit. The operator decides whether
  to keep the appended rows after reviewing the summary.
- The aggregator does **not** push and does **not** open a PR.
