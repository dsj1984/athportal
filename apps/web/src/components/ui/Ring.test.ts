// apps/web/src/components/ui/Ring.test.ts
//
// Unit tests for the Ring primitive's view-shape builder.
//
// Story #713 / Task #725 — Epic #702 design-system primitive library.
import { describe, expect, it } from 'vitest';
import { DEFAULT_RING_SIZE, DEFAULT_RING_STROKE, buildRingView } from './Ring';

describe('buildRingView', () => {
  it('uses default size and stroke when those props are omitted', () => {
    const view = buildRingView({ value: 50 });
    expect(view.size).toBe(DEFAULT_RING_SIZE);
    expect(view.stroke).toBe(DEFAULT_RING_STROKE);
  });

  it('produces a fully empty ring (dashOffset == circumference) at value=0', () => {
    const view = buildRingView({ value: 0 });
    expect(view.value).toBe(0);
    expect(view.dashOffset).toBeCloseTo(view.circumference, 5);
  });

  it('produces a fully filled ring (dashOffset == 0) at value=100', () => {
    const view = buildRingView({ value: 100 });
    expect(view.value).toBe(100);
    expect(view.dashOffset).toBeCloseTo(0, 5);
  });

  it('produces a half-filled ring (dashOffset ≈ circumference/2) at value=50', () => {
    const view = buildRingView({ value: 50 });
    expect(view.dashOffset).toBeCloseTo(view.circumference / 2, 5);
  });

  it('clamps value above 100 down to 100', () => {
    expect(buildRingView({ value: 150 }).value).toBe(100);
  });

  it('clamps value below 0 up to 0', () => {
    expect(buildRingView({ value: -10 }).value).toBe(0);
  });

  it('honours an explicit size and stroke', () => {
    const view = buildRingView({ value: 50, size: 120, stroke: 8 });
    expect(view.size).toBe(120);
    expect(view.stroke).toBe(8);
    // radius = (size - stroke) / 2
    expect(view.radius).toBe(56);
  });

  it('falls back to defaults when size or stroke is zero, negative, or non-finite', () => {
    expect(buildRingView({ value: 50, size: 0 }).size).toBe(DEFAULT_RING_SIZE);
    expect(buildRingView({ value: 50, stroke: -2 }).stroke).toBe(DEFAULT_RING_STROKE);
  });

  it('wires the brand colour token onto the stroke (per AC: labels with the brand colour)', () => {
    const view = buildRingView({ value: 50 });
    expect(view.strokeColor).toContain('--color-brand');
  });

  it('exposes an accessible label when one is provided', () => {
    const view = buildRingView({ value: 50, label: 'Recovery score' });
    expect(view.label).toBe('Recovery score');
  });

  it('returns null label when none is provided', () => {
    expect(buildRingView({ value: 50 }).label).toBeNull();
  });
});
