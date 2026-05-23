// apps/web/src/components/ui/VerifiedTick.test.ts
//
// Unit tests for the VerifiedTick primitive's view-shape builder.
//
// Story #713 / Task #728 — Epic #702 design-system primitive library.
import { describe, expect, it } from 'vitest';
import { DEFAULT_VERIFIED_TICK_SIZE, buildVerifiedTickView } from './VerifiedTick';

describe('buildVerifiedTickView', () => {
  it('uses the default size when no size prop is provided', () => {
    const view = buildVerifiedTickView();
    expect(view.size).toBe(DEFAULT_VERIFIED_TICK_SIZE);
    expect(view.size).toBe(16);
  });

  it('honours an explicit size value (prop-variant case)', () => {
    expect(buildVerifiedTickView({ size: 24 }).size).toBe(24);
  });

  it('falls back to the default size when size is zero, negative, or non-finite', () => {
    expect(buildVerifiedTickView({ size: 0 }).size).toBe(DEFAULT_VERIFIED_TICK_SIZE);
    expect(buildVerifiedTickView({ size: -5 }).size).toBe(DEFAULT_VERIFIED_TICK_SIZE);
    expect(buildVerifiedTickView({ size: Number.NaN }).size).toBe(DEFAULT_VERIFIED_TICK_SIZE);
  });

  it('uses "Verified" as the default accessible title', () => {
    expect(buildVerifiedTickView().title).toBe('Verified');
  });

  it('honours an explicit title (trimmed)', () => {
    expect(buildVerifiedTickView({ title: '  Hudl verified  ' }).title).toBe('Hudl verified');
  });

  it('wires the action-lime token onto the background fill (per AC)', () => {
    const view = buildVerifiedTickView();
    expect(view.fillColor).toContain('--color-action-lime');
  });
});
