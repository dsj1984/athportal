// apps/web/src/components/ui/Stat.test.ts
//
// Unit tests for the Stat primitive's view-shape builder.
//
// Story #713 / Task #725 — Epic #702 design-system primitive library.
import { describe, expect, it } from 'vitest';
import { buildStatView } from './Stat';

describe('buildStatView', () => {
  it('returns label/value/unit verbatim (trimmed) for the default render', () => {
    const view = buildStatView({ label: '  Win rate  ', value: 72, unit: '%' });
    expect(view.label).toBe('Win rate');
    expect(view.value).toBe('72');
    expect(view.unit).toBe('%');
  });

  it('coerces a string value through trim() and preserves it', () => {
    const view = buildStatView({ label: 'Goals', value: '12' });
    expect(view.value).toBe('12');
  });

  it('uses the display font on the value (per style-guide §2)', () => {
    const view = buildStatView({ label: 'Goals', value: 12 });
    expect(view.valueClass).toContain('font-display');
  });

  it('omits the VerifiedTick when verified is unset or false', () => {
    expect(buildStatView({ label: 'Goals', value: 12 }).showVerified).toBe(false);
    expect(buildStatView({ label: 'Goals', value: 12, verified: false }).showVerified).toBe(false);
  });

  it('surfaces the VerifiedTick when verified={true} (prop-branch case)', () => {
    const view = buildStatView({ label: 'Goals', value: 12, verified: true });
    expect(view.showVerified).toBe(true);
  });

  it('honours an up trend and applies the lime colour class', () => {
    const view = buildStatView({ label: 'Goals', value: 12, trend: 'up' });
    expect(view.trend).toBe('up');
    expect(view.trendClass).toContain('text-action-lime');
  });

  it('honours a down trend and applies the coral colour class', () => {
    const view = buildStatView({ label: 'Goals', value: 12, trend: 'down' });
    expect(view.trend).toBe('down');
    expect(view.trendClass).toContain('text-action-coral');
  });

  it('honours a flat trend and applies the muted text colour', () => {
    const view = buildStatView({ label: 'Goals', value: 12, trend: 'flat' });
    expect(view.trendClass).toContain('text-text-secondary');
  });

  it('returns null trend / hint / unit when those props are omitted', () => {
    const view = buildStatView({ label: 'Goals', value: 12 });
    expect(view.trend).toBeNull();
    expect(view.hint).toBeNull();
    expect(view.unit).toBeNull();
  });

  it('renders the hint when provided', () => {
    const view = buildStatView({ label: 'Goals', value: 12, hint: 'Last 5 games' });
    expect(view.hint).toBe('Last 5 games');
  });

  it('throws TypeError when label is empty or whitespace-only', () => {
    expect(() => buildStatView({ label: '   ', value: 12 })).toThrow(TypeError);
  });

  it('throws TypeError when value coerces to empty', () => {
    expect(() => buildStatView({ label: 'Goals', value: '   ' })).toThrow(TypeError);
  });
});
