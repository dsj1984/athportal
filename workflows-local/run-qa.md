---
description: >-
  Drive a single QA-corpus artifact (Test Plan or Exploratory Charter) against
  the local dev stack via the chrome-devtools MCP. Auto-detects artifact type
  from front-matter; dispatches to the plan-runner or charter-runner prompt.
---

# /run-qa `<id>`

`/run-qa` is the **single-artifact QA runner**. It loads exactly one
artifact from the QA corpus (a Test Plan or an Exploratory Charter),
auto-detects which kind it is from the `type:` field in the front-matter,
and dispatches to the matching sub-procedure below. The runner drives the
local dev stack through the `chrome-devtools` MCP and writes its
observations back into the artifact file (Findings + Notes appended in
place).

**Argument:** the artifact id (e.g. `tp-identity-signup-happy-path` or
`ec-org-admin-csv-import`). Optional flags:

- `--allow-non-local` — required to start a charter whose
  `safety_constraints.environment` is `preview` or `staging`. The runner
  refuses to start otherwise.

The runner does **not** auto-commit. After the run the agent prints a
one-line `git diff --stat` so the operator decides whether to keep the
appended Findings / Notes rows. The point is the operator stays in the
loop for what lands in the corpus.

> **Citation:** Tech Spec [#782](https://github.com/dsj1984/athportal/issues/782) § Runner topology;
> PRD [#781](https://github.com/dsj1984/athportal/issues/781) AC-5;
> Acceptance Spec [#783](https://github.com/dsj1984/athportal/issues/783) AC-7, AC-8, AC-9.

---

## 1. Resolve `<id>` to a path

1. Read `tests/qa-index.json` from the repo root.
2. If the file is **missing**, exit immediately with this message and do
   not invoke any MCP tool:

   ```text
   /run-qa: tests/qa-index.json is missing. Generate it with:
       pnpm run index:qa
   then re-invoke /run-qa <id>.
   ```

3. Parse the JSON and look up `<id>`. If the id is **not found**, exit
   with:

   ```text
   /run-qa: id "<id>" not found in tests/qa-index.json.
   Run `pnpm run index:qa` to regenerate the index, then verify the id
   spelling against the artifact's front-matter `id:` field.
   ```

4. Resolve the matching path (e.g.
   `tests/plans/identity/tp-identity-signup-happy-path.plan.md` or
   `tests/charters/org-admin/ec-org-admin-csv-import.charter.md`).

> **Note:** until `pnpm run index:qa` ships in a later story, the runner
> falls back to a recursive `tests/plans/**` + `tests/charters/**` search
> on filename `<id>.{plan,charter}.md`. The fallback path emits a soft
> warning so the operator notices the missing index.

## 2. Read the artifact and front-matter

1. Use the `Read` tool to load the full artifact file.
2. Parse the YAML front-matter (the block between the two leading `---`
   fences). Pull out at minimum: `id`, `type`, `title`, `domain`,
   `route_prefixes`, and the type-specific fields.
3. **Dispatch on `type:`** — exactly one of the two sub-procedures below
   MUST run; do not interleave them.

---

## Plan runner — when `type: plan`

Test Plans are scripted, expected-outcome-per-step user journeys. The
plan runner drives the journey deterministically, verifies the
`**Expected:**` line at each step, and prints a final pass/fail table.

### P1. Prerequisite gate

1. Read the `## Setup` section of the artifact verbatim. Each Setup
   bullet is a prerequisite the runner expects to be true before Step 1.
2. For each prerequisite, check whether it is met. The most common
   examples are:
   - "local stack running (pnpm dev)" → probe
     `http://localhost:4321/` and `http://localhost:8787/` with
     `chrome-devtools` `navigate_page`; if either returns a connection
     error, the local stack is **not** running.
   - "DB seeded …" or "no existing user matches …" → these are operator
     prerequisites; surface them in the pre-flight summary and proceed
     only if the operator's environment can plausibly satisfy them.
3. If a prerequisite is **unmet** (most commonly the local stack is
   down), refuse to proceed and print:

   ```text
   /run-qa: plan "<id>" cannot start — prerequisite not met:
       <prerequisite text>
   Start the local stack with `pnpm dev` (or address the missing
   prerequisite) and re-invoke /run-qa <id>.
   ```

   Do not invoke any further MCP tool. Stop.

### P2. Drive each Step

For each numbered step in `## Steps`, in order:

1. **Act.** Translate the step's prose into the minimum sequence of
   `chrome-devtools` MCP calls needed to drive the surface — most
   commonly `navigate_page`, `take_snapshot`, `click`, `fill_form`,
   `evaluate_script`, `press_key`, and `wait_for`. Prefer
   `take_snapshot` over `take_screenshot` for assertion targets; the
   structured DOM tree is cheaper and more stable than pixel diffing.

2. **Assert semantically.** After the step's action settles, snapshot
   the page and compare the **Expected:** sentence against the live
   page text, headings, ARIA roles, and URL. Verification MUST be
   semantic — match landmarks ("heading announces sign-up flow", "URL
   ends in `/onboarding`", "input with `name=email` is present"). It
   MUST NOT rely on pixel comparison or implementation-detail selectors
   the plan didn't name.

3. **Record one row** in the pass/fail table. Columns:

   ```text
   | # | Step (short) | Expected (short) | Actual | Status |
   ```

   `Status` is one of `PASS`, `FAIL`, or `DEPENDENT-FAIL`. `Actual`
   captures the briefest snippet of page state that proves PASS or
   contradicts the Expected on FAIL.

4. **Continue on failure.** If a Step's status is `FAIL`, mark
   subsequent steps that depend on its post-state as `DEPENDENT-FAIL`
   in the same row's `Status` column, but **continue executing** later
   Steps when they have any chance of running standalone (e.g. a "sign
   out" step at the end is still worth running even if the middle
   broke). Only abort the loop when every remaining Step is provably
   meaningless (e.g. the app is unreachable).

### P3. Cleanup (always)

Run the `## Cleanup` section verbatim **regardless** of pass/fail
outcome. Cleanup typically signs the test user out and resets seed
data. The runner MUST surface a clear note when a Cleanup step itself
fails (the operator may need to reset the DB manually).

### P4. Emit the table + final summary

Print the assembled pass/fail table as the final response, followed by:

- One-line tally: `<n> PASS / <n> FAIL / <n> DEPENDENT-FAIL out of <total> Steps`.
- The one-line `git diff --stat` output for the artifact file. (A
  plan run never modifies the artifact, so this is expected to be
  empty — included for symmetry with the charter runner.)

---

## Charter runner — when `type: charter`

Exploratory Charters are time-boxed, heuristic-driven sessions whose
outcome is a list of Findings — not a pass/fail. The charter runner
applies named heuristics against the target surface, records observations
in `## Notes`, and appends structured rows to `## Findings`.

### C1. Safety gate (FIRST CHECK — before any MCP call)

This is the load-bearing gate. It MUST run before the runner invokes a
single `chrome-devtools` MCP tool.

1. Read `safety_constraints.environment` from the front-matter.
2. **If `environment !== "local"`** and the operator did **not** pass
   `--allow-non-local`, refuse to start. Print:

   ```text
   /run-qa: charter "<id>" targets environment "<environment>" — refused.
   The charter runner only auto-starts against environment "local".
   To proceed against "<environment>", re-invoke with --allow-non-local
   and confirm you are pointed at the intended stack:
       /run-qa <id> --allow-non-local
   ```

   Do not invoke any MCP tool. Stop.

3. **If `environment === "local"`** OR the operator passed
   `--allow-non-local`, continue to C2.

### C2. Time-box + mutation-surface announcement

Before driving the surface, print the following block verbatim so the
operator sees the agent has read the safety contract:

```text
/run-qa charter dispatch
  id:          <id>
  title:       <title>
  environment: <environment>
  time box:    <time_box_minutes> minutes (agent stops driving when elapsed)
  surface:     <route_prefixes joined by ", ">
  heuristics:  <heuristic names joined by ", ">
  mutation surface (declared safe to mutate):
    - <mutation_surface[0]>
    - <mutation_surface[1]>
    - ...
  required reset (run after the session):
      <safety_constraints.required_reset>
```

**Agent self-constraints (enforced during the session):**

- You MAY mutate only the tables / services declared in
  `safety_constraints.mutation_surface`.
- If at any point you discover that a heuristic would mutate state
  **outside** the declared surface, **stop** the heuristic, append a
  Finding describing the surface drift (severity `high`), and continue
  with the next heuristic.
- When the time box elapses, append `TIME-BOX REACHED` to `## Notes`
  and stop driving the surface. Skip remaining heuristics; jump
  straight to C5.

### C3. Load heuristics

For each `heuristics:` entry:

1. Resolve the file at `tests/charters/_heuristics/<name>.md`. If
   missing, append a `medium`-severity Finding that the heuristic file
   is absent and skip to the next heuristic.
2. Read the heuristic body. The body describes the *probe family* in
   plain prose; the runner adapts the probes to the target surface
   named by `route_prefixes`.

### C4. Apply heuristics

For each heuristic, in order:

1. Navigate to a `route_prefixes` entry via `chrome-devtools`
   `navigate_page`. Snapshot the landing surface (`take_snapshot`).
2. Apply the heuristic's probes against the surface. Snapshot freely —
   snapshots are cheap and serve as audit evidence later.
3. Append observations to `## Notes` (append-only; never rewrite prior
   notes). Use bullet format:

   ```markdown
   - **<heuristic>** @ <route>: <observation>
   ```

4. When a probe identifies a probable bug, append a row to the
   `## Findings` table:

   ```markdown
   | id | title | severity | repro | suggested-promotion |
   ```

   Field rules:

   - **id** — sequential within the file: `f-001`, `f-002`, …. If the
     table already has prior rows, continue the numbering.
   - **title** — one-line summary, ≤ 80 chars, no trailing period.
   - **severity** — exactly one of `low`, `medium`, `high`, `critical`.
   - **repro** — minimum steps a human would follow to re-witness the
     defect. When the agent was unable to drive the surface end-to-end
     (e.g. local stack not running), write a `DRY RUN: <reason>`
     prefix and describe what the heuristic *would* probe.
   - **suggested-promotion** — what kind of follow-up artifact should
     own this finding next: `plan`, `feature scenario`, `both`, or
     `investigate` (when the bug is unconfirmed and needs a human
     repro before deciding).

### C5. Required reset + diff

After heuristics complete (or the time box reaches), print:

1. The `safety_constraints.required_reset` command verbatim and offer
   to execute it. Do **not** execute without explicit operator
   confirmation — the reset typically rebuilds the DB and is
   destructive.
2. The one-line `git diff --stat` for the artifact file so the
   operator sees how many Findings rows the run appended.

---

## Persistence contract

- The runner **modifies the artifact in place**: charter Findings rows
  and Notes bullets are appended; plan runs leave the artifact
  unchanged.
- The runner **never commits**. The operator decides whether to keep
  the appended rows (charter) or whether to fix the surface (plan).
- The runner **never pushes** and **never opens a PR**.
