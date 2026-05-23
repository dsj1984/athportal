// apps/web/src/components/ui/Avatar.test.ts
//
// Unit tests for the Avatar primitive's pure-TS view-shape builder
// and initials helper. The `.astro` sibling renders the markup; the
// builder is the testable surface (web Vitest project runs in node
// env with no JSX/Astro renderer).
//
// Story #574 / Task #585 (original). Story #713 / Task #721 (refactor
// to add `hue` + `size` + OKLCH-gradient fallback per style-guide §3.1).
import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_AVATAR_TEST_ID,
  DEFAULT_AVATAR_HUE,
  DEFAULT_AVATAR_SIZE,
  buildAvatarView,
  computeInitials,
} from './Avatar';

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

  it('defaults hue to 270 (brand-violet) when no hue prop is provided', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace' });
    expect(view.hue).toBe(DEFAULT_AVATAR_HUE);
    expect(view.hue).toBe(270);
  });

  it('honours an explicit hue value', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace', hue: 180 });
    expect(view.hue).toBe(180);
  });

  it('normalises out-of-range hue values into [0, 360)', () => {
    expect(buildAvatarView({ name: 'A', hue: 420 }).hue).toBe(60);
    expect(buildAvatarView({ name: 'A', hue: -30 }).hue).toBe(330);
    expect(buildAvatarView({ name: 'A', hue: 720 }).hue).toBe(0);
  });

  it('defaults size to 40px when no size prop is provided', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace' });
    expect(view.size).toBe(DEFAULT_AVATAR_SIZE);
    expect(view.size).toBe(40);
  });

  it('honours an explicit size value', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace', size: 64 });
    expect(view.size).toBe(64);
  });

  it('falls back to the default size when size is zero, negative, or non-finite', () => {
    expect(buildAvatarView({ name: 'A', size: 0 }).size).toBe(40);
    expect(buildAvatarView({ name: 'A', size: -5 }).size).toBe(40);
    expect(buildAvatarView({ name: 'A', size: Number.NaN }).size).toBe(40);
  });

  it('emits an OKLCH-gradient fallback style on the initials branch (per style-guide §3.1)', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace', hue: 200, size: 48 });
    expect(view.src).toBeNull();
    expect(view.fallbackStyle).toContain('width:48px');
    expect(view.fallbackStyle).toContain('height:48px');
    expect(view.fallbackStyle).toContain('oklch(');
    expect(view.fallbackStyle).toContain('linear-gradient(');
    expect(view.fallbackStyle).toContain('200');
  });

  it('emits a width/height style on the photo branch (no gradient)', () => {
    const view = buildAvatarView({ name: 'Ada Lovelace', src: '/img/ada.png', size: 96 });
    expect(view.imageStyle).toBe('width:96px;height:96px;');
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
