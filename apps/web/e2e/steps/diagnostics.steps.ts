/**
 * Diagnostics step library (Story #963).
 *
 * Steps that inspect runtime diagnostics — browser console output and
 * uncaught page errors — for the acceptance tier. These steps are
 * the regression guard for Story #958's class of bug, where an inline
 * `<script lang="ts">` block in three onboarding islands shipped with
 * a raw `import` statement and threw `SyntaxError: Cannot use import
 * statement outside a module` on every load. The form's submit
 * handler never wired up; a real user signing up landed at a
 * silent-GET URL instead of `POST /api/v1/auth/onboard`.
 *
 * `testing-standards.md` § Assertion Placement Rule bars wire-shape
 * assertions from `.feature` files but explicitly permits user-visible
 * assertions. A `SyntaxError` in the DevTools console IS user-visible
 * (it breaks the page) and IS the contract this guard locks down.
 *
 * Scope of the assertion:
 *
 *   - `console.error` lines AND uncaught page errors are both
 *     captured. The error class names commonly thrown when a script
 *     fails to wire up (`SyntaxError`, `ReferenceError`, `TypeError`)
 *     are explicitly named in the failure message so the operator
 *     reading a CI log knows what class of breakage tripped the
 *     guard.
 *   - Capture starts on `Before({ tags: '@asserts-no-console-errors' })`
 *     and the assertion runs from `Then the page reports no console
 *     errors`. The Before hook installs the listeners; the Then step
 *     reads the captured buffer.
 *   - The hook is scoped by tag so only scenarios that opt in via
 *     `@asserts-no-console-errors` pay the listener cost (and so a
 *     scenario that legitimately produces a console.warn for some
 *     other invariant does not have to fight against this guard).
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

// playwright-bdd exposes `Before` / `After` lifecycle hooks via the
// `createBdd()` builder, not as top-level exports. Keeping them on the
// builder return is how the package binds the hooks to the right
// internal test type — a direct top-level import does not exist.
const { Before, Then } = createBdd();

/**
 * Test-scoped buffer of captured console messages and page errors.
 * Populated by the `Before` hook below, drained by the `Then` step.
 *
 * Stored on the test-scoped fixtures bag (the `TestInfo` object) via
 * a symbol so parallel scenarios don't share a module-level list. The
 * symbol is keyed on the workerInfo + testInfo pair which playwright-bdd
 * threads through the `Before` hook's first argument.
 */
interface CapturedConsoleEntry {
  readonly source: 'console.error' | 'pageerror';
  readonly text: string;
}

const CAPTURED_KEY = Symbol.for('athportal.diagnostics.capturedConsole');

interface WithCapturedConsole {
  [CAPTURED_KEY]?: CapturedConsoleEntry[];
}

/**
 * Install console.error and pageerror listeners on the current
 * Playwright page for any scenario tagged `@asserts-no-console-errors`.
 *
 * Both surfaces are captured:
 *   - `page.on('console', ...)` fires for every `console.*` call. We
 *     filter to `error`-level entries only — a stray `console.warn`
 *     from a third-party SDK should not flip the guard.
 *   - `page.on('pageerror', ...)` fires for uncaught exceptions that
 *     bubble to the window. This is the surface that catches the
 *     Story #958 class of bug (a raw `import` in a non-module script
 *     throws `SyntaxError` at parse time, which never reaches
 *     `console.error` but does reach `pageerror`).
 *
 * The listeners stay attached for the scenario's lifetime; the
 * `Then` step reads the captured buffer at the assertion point.
 */
Before({ tags: '@asserts-no-console-errors' }, async function ({ page }) {
  const captured: CapturedConsoleEntry[] = [];
  (this as WithCapturedConsole)[CAPTURED_KEY] = captured;

  page.on('console', (message) => {
    if (message.type() === 'error') {
      captured.push({ source: 'console.error', text: message.text() });
    }
  });

  page.on('pageerror', (err) => {
    // Capture the constructor name + message so an operator reading
    // the CI log can immediately see "SyntaxError: Cannot use import
    // statement outside a module" instead of a stack trace.
    const name = err.name || 'Error';
    const message = err.message || String(err);
    captured.push({ source: 'pageerror', text: `${name}: ${message}` });
  });
});

/**
 * Assert that no console.error lines and no uncaught page errors were
 * observed since the scenario's `Before` hook ran. Fails with the
 * captured entries in the assertion message so the operator can
 * diagnose without re-running.
 *
 * Critical regression guard for Story #958 (the `lang="ts"` →
 * `is:inline` Astro v5 bug that broke `/onboarding`).
 */
Then('the page reports no console errors', async function () {
  const captured = (this as WithCapturedConsole)[CAPTURED_KEY] ?? [];
  if (captured.length === 0) return;

  // Format the diagnostic so it reads as a single readable block in
  // a CI log. Each entry on its own line, prefixed by the surface
  // that captured it so the reader knows whether it came from
  // `console.error` or an uncaught exception.
  const formatted = captured.map((entry) => `  [${entry.source}] ${entry.text}`).join('\n');
  expect.soft(captured, `Unexpected console output:\n${formatted}`).toEqual([]);
});
