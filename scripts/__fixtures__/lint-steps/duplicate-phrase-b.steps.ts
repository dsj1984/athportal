/**
 * lint-steps fixture — paired with duplicate-phrase-a.steps.ts.
 *
 * Companion file that re-declares the same Given phrase, producing the
 * duplicate-phrase collision the lint:steps:fixtures harness expects.
 */
import { createBdd } from 'playwright-bdd';

const { Given } = createBdd();

Given('I am a duplicated phrase across two files', async () => {
  // Empty body — see duplicate-phrase-a.steps.ts.
});
