// apps/web/src/components/ui/PageHeader.test.ts
//
// Unit tests for the PageHeader primitive. Targets the pure
// `buildPageHeader` builder that the `.astro` sibling renders; the web
// workspace's Vitest project runs in a node environment with no
// JSX/Astro renderer, so the builder is the testable surface (mirrors
// the EmptyState convention).
//
// Story #836 / Task #845 — Epic #828 dashboard surface.
import { describe, expect, it } from 'vitest';
import { PAGE_HEADER_TEST_IDS, type PageHeaderProps, buildPageHeader } from './PageHeader';

const baseProps: PageHeaderProps = {
  title: 'Dashboard',
};

describe('buildPageHeader (title-only branch)', () => {
  it('returns the title verbatim when only a title is provided', () => {
    const view = buildPageHeader(baseProps);
    expect(view.title).toBe('Dashboard');
  });

  it('emits a null intro when no intro prop is provided', () => {
    const view = buildPageHeader(baseProps);
    expect(view.intro).toBeNull();
  });

  it('marks hasActions false when the actions slot is not present', () => {
    const view = buildPageHeader(baseProps);
    expect(view.hasActions).toBe(false);
  });

  it('exposes the canonical data-testids for the root, title, intro, and actions', () => {
    const view = buildPageHeader(baseProps);
    expect(view.testIds.root).toBe(PAGE_HEADER_TEST_IDS.root);
    expect(view.testIds.root).toBe('page-header');
    expect(view.testIds.title).toBe('page-header-title');
    expect(view.testIds.intro).toBe('page-header-intro');
    expect(view.testIds.actions).toBe('page-header-actions');
  });

  it('styles the title with the display typeface and primary text token per style-guide §3', () => {
    const view = buildPageHeader(baseProps);
    expect(view.titleClass).toContain('font-display');
    expect(view.titleClass).toContain('text-text-primary');
    expect(view.titleClass).toContain('font-semibold');
  });

  it('uses the bordered page-chrome layout from style-guide §4 on the outer header', () => {
    const view = buildPageHeader(baseProps);
    expect(view.rootClass).toContain('border-b');
    expect(view.rootClass).toContain('border-border');
    expect(view.rootClass).toContain('flex');
  });

  it('lays the header out side-by-side at the sm breakpoint (desktop)', () => {
    const view = buildPageHeader(baseProps);
    expect(view.rootClass).toContain('sm:flex-row');
    expect(view.rootClass).toContain('sm:justify-between');
  });

  it('stacks the header on mobile (default flex-col)', () => {
    const view = buildPageHeader(baseProps);
    expect(view.rootClass).toContain('flex-col');
  });
});

describe('buildPageHeader (title + intro branch)', () => {
  it('returns the intro verbatim when an intro prop is provided', () => {
    const view = buildPageHeader({
      ...baseProps,
      intro: 'Your post-onboarding home.',
    });
    expect(view.intro).toBe('Your post-onboarding home.');
  });

  it('styles the intro with the secondary text token and body typography per style-guide §3', () => {
    const view = buildPageHeader({
      ...baseProps,
      intro: 'Your post-onboarding home.',
    });
    expect(view.introClass).toContain('text-text-secondary');
    expect(view.introClass).toContain('text-sm');
  });

  it('trims surrounding whitespace from title and intro', () => {
    const view = buildPageHeader({
      title: '  Dashboard  ',
      intro: '\tYour post-onboarding home.\n',
    });
    expect(view.title).toBe('Dashboard');
    expect(view.intro).toBe('Your post-onboarding home.');
  });

  it('collapses a whitespace-only intro back to null', () => {
    const view = buildPageHeader({ ...baseProps, intro: '   ' });
    expect(view.intro).toBeNull();
  });
});

describe('buildPageHeader (actions-slot branch)', () => {
  it('marks hasActions true when the caller signals the actions slot is present', () => {
    const view = buildPageHeader(baseProps, { hasActions: true });
    expect(view.hasActions).toBe(true);
  });

  it('right-aligns the actions container on desktop and stacks it on mobile', () => {
    const view = buildPageHeader(baseProps, { hasActions: true });
    expect(view.actionsClass).toContain('flex-col');
    expect(view.actionsClass).toContain('sm:flex-row');
    expect(view.actionsClass).toContain('sm:justify-end');
  });

  it('keeps hasActions false when the options flag is omitted', () => {
    const view = buildPageHeader(baseProps, {});
    expect(view.hasActions).toBe(false);
  });

  it('exposes hasActions independently of intro presence (intro + actions branch)', () => {
    const view = buildPageHeader(
      { ...baseProps, intro: 'Your post-onboarding home.' },
      { hasActions: true },
    );
    expect(view.intro).toBe('Your post-onboarding home.');
    expect(view.hasActions).toBe(true);
  });
});

describe('buildPageHeader (class composition)', () => {
  it('merges author-supplied extra classes through cn', () => {
    const view = buildPageHeader({ ...baseProps, class: 'mb-8' });
    expect(view.rootClass).toContain('mb-8');
  });
});

describe('buildPageHeader (validation)', () => {
  it('throws when title is empty or whitespace-only', () => {
    expect(() => buildPageHeader({ title: '   ' })).toThrow(TypeError);
  });

  it('throws when title is the empty string', () => {
    expect(() => buildPageHeader({ title: '' })).toThrow(TypeError);
  });
});
