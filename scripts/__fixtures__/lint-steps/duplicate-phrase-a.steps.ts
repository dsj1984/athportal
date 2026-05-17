/**
 * lint-steps fixture — paired with duplicate-phrase-b.steps.ts.
 *
 * Defines the same Given phrase that duplicate-phrase-b.steps.ts also
 * defines. The pair together should be rejected by [no-duplicate-phrase].
 * Linted in isolation neither fixture trips a rule, so the harness lints
 * the two files together.
 */
import { createBdd } from 'playwright-bdd';

const { Given } = createBdd();

Given('I am a duplicated phrase across two files', async () => {
  // Empty body — the duplicate-phrase rule fires on phrase declarations,
  // not on body content.
});
