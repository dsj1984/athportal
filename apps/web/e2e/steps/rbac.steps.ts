/**
 * RBAC (role-based access control) step library.
 *
 * Owns Then phrases that assert role-gated, user-visible RBAC outcomes —
 * refusal banners, access-denied surfaces, role-membership invariants
 * the user sees in their UI. Policy-level RBAC assertions live at the
 * unit tier in `packages/shared/src/rbac/`; enforcement-shape (HTTP
 * status codes, error envelope shapes, rollback semantics) assertions
 * live at the contract tier. This file owns only user-visible RBAC
 * outcomes — see the assertion-placement rule in
 * `.agents/rules/testing-standards.md`.
 */
import { expect } from '@playwright/test';
import { createBdd } from 'playwright-bdd';

const { Then } = createBdd();

/**
 * Last-admin refusal banner (AC-7). The banner is the user-visible side
 * of the last-admin-removal invariant — the contract-tier test covers
 * the 409 LAST_ADMIN envelope and the in-transaction rollback. Here we
 * only assert the operator's eyes-on-screen outcome: a banner is
 * visible whose accessible name names the refusal.
 */
Then('I see the last-admin refusal banner', async ({ page }) => {
  await expect(
    page.getByRole('alert', { name: /last (remaining )?admin/i }),
  ).toBeVisible();
});
