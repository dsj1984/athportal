// apps/web/src/components/ui/EmptyState.test.ts
//
// Unit tests for the shared EmptyState primitive. Targets the pure
// `buildEmptyState` builder that the `.astro` sibling renders; the web
// workspace's Vitest project runs in a node environment with no
// JSX/Astro renderer, so the builder is the testable surface.
import { describe, expect, it } from 'vitest';
import { EMPTY_STATE_TEST_IDS, type EmptyStateProps, buildEmptyState } from './EmptyState';

const baseProps: EmptyStateProps = {
  title: 'No teams yet',
  body: 'Join or create a team to see your roster here.',
};

describe('buildEmptyState', () => {
  it('returns the title and body verbatim when both are provided', () => {
    const view = buildEmptyState(baseProps);
    expect(view.title).toBe('No teams yet');
    expect(view.body).toBe('Join or create a team to see your roster here.');
  });

  it('omits the CTA when no action prop is provided', () => {
    const view = buildEmptyState(baseProps);
    expect(view.action).toBeNull();
  });

  it('wires the CTA through when an action prop is provided', () => {
    const view = buildEmptyState({
      ...baseProps,
      action: { label: 'Join a team', href: '/teams/join' },
    });
    expect(view.action).toEqual({ label: 'Join a team', href: '/teams/join' });
  });

  it('exposes the canonical data-testids for the root and the CTA', () => {
    const view = buildEmptyState({
      ...baseProps,
      action: { label: 'Complete your profile', href: '/profile' },
    });
    expect(view.testIds.root).toBe(EMPTY_STATE_TEST_IDS.root);
    expect(view.testIds.root).toBe('empty-state');
    expect(view.testIds.cta).toBe(EMPTY_STATE_TEST_IDS.cta);
    expect(view.testIds.cta).toBe('empty-state-cta');
  });

  it('allows the root testId to be overridden for widget-scoped surfaces', () => {
    const view = buildEmptyState({
      ...baseProps,
      testId: 'dashboard-widget-roster-empty',
    });
    expect(view.testIds.root).toBe('dashboard-widget-roster-empty');
    // CTA testId stays canonical so step definitions can target it
    // uniformly regardless of widget scope.
    expect(view.testIds.cta).toBe('empty-state-cta');
  });

  it('trims surrounding whitespace from title and body', () => {
    const view = buildEmptyState({
      title: '  No teams yet  ',
      body: '\tJoin or create a team to see your roster here.\n',
    });
    expect(view.title).toBe('No teams yet');
    expect(view.body).toBe('Join or create a team to see your roster here.');
  });

  it('throws when title is empty or whitespace-only', () => {
    expect(() => buildEmptyState({ ...baseProps, title: '   ' })).toThrow(TypeError);
  });

  it('throws when body is empty or whitespace-only', () => {
    expect(() => buildEmptyState({ ...baseProps, body: '' })).toThrow(TypeError);
  });

  it('throws when an action prop is provided with an empty label', () => {
    expect(() =>
      buildEmptyState({
        ...baseProps,
        action: { label: '   ', href: '/teams/join' },
      }),
    ).toThrow(TypeError);
  });

  it('throws when an action prop is provided with an empty href', () => {
    expect(() =>
      buildEmptyState({
        ...baseProps,
        action: { label: 'Join a team', href: '' },
      }),
    ).toThrow(TypeError);
  });
});
