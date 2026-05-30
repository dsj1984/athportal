// apps/web/src/pages/layout-shell-guard.test.ts
//
// Regression guard for the missing-styles bug class (#1064 follow-up).
//
// The design-system stylesheet (`apps/web/src/styles/global.css`, which
// pulls in Tailwind + the @theme token catalogue) is imported in exactly
// ONE place: `layouts/RootLayout.astro`. `AppLayout` composes RootLayout,
// so any page that renders through RootLayout or AppLayout inherits the
// stylesheet. A page that instead renders its own bare `<html>` document
// shell never loads global.css, so every Tailwind class on it is inert and
// the page renders completely unstyled.
//
// This guard pins the invariant that **no page owns the document shell** —
// the `<html>` element is a layout responsibility. A page that reintroduces
// a raw `<html>` (the exact shape that shipped unstyled invitation/roster/
// team pages) fails this test, pointing the author back to RootLayout /
// AppLayout before the regression can reach a browser.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PAGES_DIR = dirname(fileURLToPath(import.meta.url));

function listAstroPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listAstroPages(full));
    } else if (entry.name.endsWith('.astro')) {
      out.push(full);
    }
  }
  return out;
}

describe('page layout-shell guard', () => {
  const pages = listAstroPages(PAGES_DIR);

  it('discovers the .astro page set', () => {
    // Sanity check so a glob/path regression can't make the guard vacuous.
    expect(pages.length).toBeGreaterThan(5);
  });

  it('no page renders its own <html> document shell (the shell is a layout responsibility, and is where global.css loads)', () => {
    const offenders = pages
      .filter((file) => /<html[\s>]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(file.indexOf('pages')));

    expect(
      offenders,
      `These pages render a raw <html> shell and therefore never import global.css — ` +
        `they will render unstyled. Wrap them in RootLayout (anonymous/public) or ` +
        `AppLayout (authenticated) instead:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
