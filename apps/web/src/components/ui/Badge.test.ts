// apps/web/src/components/ui/Badge.test.ts
//
// Unit tests for the Badge primitive's class-builder. Asserts the
// soft-translucent-pill rule from docs/style-guide.md §3.4 — every
// tone × dot combination emits `bg-<color>/15` + `text-<color>`, and
// NEVER a solid `bg-*-900` background.
//
// Story #713 / Task #724 — Epic #702 design-system primitive library.
import { describe, expect, it } from 'vitest';
import { BADGE_TONES, type BadgeTone, buildBadgeView } from './_lib/badge';

describe('buildBadgeView — tone × dot matrix', () => {
  const expectations: Record<BadgeTone, { bg: string; text: string; dot: string }> = {
    brand: { bg: 'bg-brand/15', text: 'text-brand', dot: 'bg-brand' },
    cyan: { bg: 'bg-action-cyan/15', text: 'text-action-cyan', dot: 'bg-action-cyan' },
    lime: { bg: 'bg-action-lime/15', text: 'text-action-lime', dot: 'bg-action-lime' },
    amber: { bg: 'bg-action-amber/15', text: 'text-action-amber', dot: 'bg-action-amber' },
    coral: { bg: 'bg-action-coral/15', text: 'text-action-coral', dot: 'bg-action-coral' },
    slate: { bg: 'bg-slate-500/15', text: 'text-slate-700', dot: 'bg-slate-500' },
  };

  for (const tone of BADGE_TONES) {
    for (const dot of [false, true] as const) {
      it(`tone=${tone} dot=${dot} emits the soft-translucent class pair`, () => {
        const view = buildBadgeView({ tone, dot });
        const exp = expectations[tone];
        expect(view.tone).toBe(tone);
        expect(view.showDot).toBe(dot);
        expect(view.rootClass).toContain(exp.bg);
        expect(view.rootClass).toContain(exp.text);
        if (dot) {
          expect(view.dotClass).toContain(exp.dot);
        }
      });

      it(`tone=${tone} dot=${dot} NEVER emits a solid bg-*-900 background (style-guide §3.4 negative case)`, () => {
        const view = buildBadgeView({ tone, dot });
        // The style-guide forbids `bg-cyan-900` / `bg-brand-900` / etc.
        // for chips — any solid-dark class on the root would mean the
        // soft-translucent rule has been bypassed. The dot is a
        // separate element and is allowed to be a solid colour; only
        // the chip background is constrained.
        expect(view.rootClass).not.toMatch(/\bbg-[a-z-]+-900\b/);
      });
    }
  }
});

describe('buildBadgeView — defaults and props', () => {
  it('defaults to the slate tone when no tone prop is provided', () => {
    const view = buildBadgeView();
    expect(view.tone).toBe('slate');
    expect(view.rootClass).toContain('bg-slate-500/15');
  });

  it('defaults to dot=false when no dot prop is provided', () => {
    const view = buildBadgeView({ tone: 'brand' });
    expect(view.showDot).toBe(false);
  });

  it('falls back to the slate tone for unknown tone values (defensive)', () => {
    const view = buildBadgeView({ tone: 'mystery' as unknown as BadgeTone });
    expect(view.tone).toBe('slate');
  });

  it('merges author-supplied extra classes through cn', () => {
    const view = buildBadgeView({ tone: 'cyan', class: 'uppercase' });
    expect(view.rootClass).toContain('uppercase');
    expect(view.rootClass).toContain('text-action-cyan');
  });

  it('always emits the pill structural classes (rounded-full, inline-flex)', () => {
    const view = buildBadgeView({ tone: 'lime' });
    expect(view.rootClass).toContain('rounded-full');
    expect(view.rootClass).toContain('inline-flex');
  });
});
