// apps/web/src/components/ui/Logo.test.ts
//
// Unit tests for the Logo primitive's view-shape builder.
//
// Story #713 / Task #728 — Epic #702 design-system primitive library.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOGO_SIZE, buildLogoView } from './Logo';

describe('buildLogoView', () => {
  it('uses the default size when no size prop is provided', () => {
    const view = buildLogoView();
    expect(view.size).toBe(DEFAULT_LOGO_SIZE);
    expect(view.size).toBe(32);
  });

  it('honours an explicit size value (prop-variant case)', () => {
    expect(buildLogoView({ size: 48 }).size).toBe(48);
  });

  it('falls back to the default size when size is zero, negative, or non-finite', () => {
    expect(buildLogoView({ size: 0 }).size).toBe(DEFAULT_LOGO_SIZE);
    expect(buildLogoView({ size: -10 }).size).toBe(DEFAULT_LOGO_SIZE);
    expect(buildLogoView({ size: Number.NaN }).size).toBe(DEFAULT_LOGO_SIZE);
  });

  it('uses a sensible default title when none is provided', () => {
    const view = buildLogoView();
    expect(view.title).toBe('Athlete Portal');
  });

  it('honours an explicit title (trimmed)', () => {
    expect(buildLogoView({ title: '  Acme FC  ' }).title).toBe('Acme FC');
  });

  it('wires the brand → action-cyan gradient stops (per AC)', () => {
    const view = buildLogoView();
    expect(view.gradientStart).toContain('--color-brand');
    expect(view.gradientEnd).toContain('--color-action-cyan');
  });
});
