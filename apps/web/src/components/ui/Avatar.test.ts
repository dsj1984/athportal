// apps/web/src/components/ui/Avatar.test.ts
//
// Unit tests for the Avatar primitive's pure-TS view-shape builder
// and initials helper. The `.astro` sibling renders the markup; the
// builder is the testable surface (web Vitest project runs in node
// env with no JSX/Astro renderer).
//
// Story #574 / Task #585.
import { describe, expect, it } from 'vitest';
import { DASHBOARD_AVATAR_TEST_ID, buildAvatarView, computeInitials } from './Avatar';

describe('buildAvatarView', () => {
  it('renders the photo branch when src is a non-empty string', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace', src: '/img/ada.png' });
    expect(view.src).toBe('/img/ada.png');
  });

  it('falls back to the initials branch when src is null', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace', src: null });
    expect(view.src).toBeNull();
    expect(view.initials).toBe('AL');
  });

  it('falls back to initials when src is undefined', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace' });
    expect(view.src).toBeNull();
    expect(view.initials).toBe('AL');
  });

  it('falls back to initials when src is whitespace-only', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace', src: '   ' });
    expect(view.src).toBeNull();
  });

  it('exposes the canonical dashboard-avatar testId by default', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace' });
    expect(view.testId).toBe(DASHBOARD_AVATAR_TEST_ID);
    expect(view.testId).toBe('dashboard-avatar');
  });

  it('allows the testId to be overridden for non-dashboard surfaces', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace', testId: 'roster-avatar' });
    expect(view.testId).toBe('roster-avatar');
  });

  it('keeps the name verbatim (trimmed) so the .astro renderer can use it as alt text', () => {
    const view = buildAvatarView({ name: '  Ada Lovelace  ' });
    expect(view.name).toBe('Ada Lovelace');
  });

  it('throws TypeError when name is empty or whitespace-only', () => {
    expect(() => buildAvatarView({ name: '   ' })).toThrow(TypeError);
    expect(() => buildAvatarView({ name: '' })).toThrow(TypeError);
  });
});

describe('computeInitials', () => {
  it('returns the first letter of the first and last token, uppercased', () => {
    expect(computeInitials('Ada Lovelace')).toBe('AL');
  });

  it('returns a single character for single-token names', () => {
    expect(computeInitials('Ada')).toBe('A');
    expect(computeInitials('ada')).toBe('A');
  });

  it('ignores middle tokens for three-or-more-token names', () => {
    expect(computeInitials('Ada Augusta Lovelace')).toBe('AL');
    expect(computeInitials('A B C D')).toBe('AD');
  });

  it('handles surrounding and internal whitespace', () => {
    expect(computeInitials('  Ada    Lovelace  ')).toBe('AL');
  });

  it('returns the empty string for an empty input (defensive)', () => {
    expect(computeInitials('')).toBe('');
    expect(computeInitials('   ')).toBe('');
  });
});
