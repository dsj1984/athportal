// apps/web/src/components/ui/Btn.test.ts
//
// Unit tests for the Btn primitive's cva variant matrix. The `.astro`
// sibling renders the <button> markup; the cva object is the testable
// surface (the web Vitest project runs in node env with no Astro
// renderer). Every kind × size combination is exercised so any change
// to the matrix surfaces in a failing test.
//
// Story #715 / Task #722.

import { describe, expect, it } from 'vitest';
import { btnVariants, type BtnKind, type BtnSize } from './_lib/btn';

const KINDS: readonly BtnKind[] = ['primary', 'ghost', 'subtle', 'coral'];
const SIZES: readonly BtnSize[] = ['sm', 'default', 'lg'];

describe('btnVariants — base classes', () => {
  it('always includes the focus-visible ring keyed to --color-brand', () => {
    const cls = btnVariants({});
    expect(cls).toContain('focus-visible:ring-brand/40');
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('focus-visible:ring-offset-2');
  });

  it('always includes the disabled utility classes', () => {
    const cls = btnVariants({});
    expect(cls).toContain('disabled:pointer-events-none');
    expect(cls).toContain('disabled:opacity-50');
  });

  it('applies the default kind=primary and size=default when called with no args', () => {
    const cls = btnVariants({});
    // primary fill
    expect(cls).toContain('bg-brand');
    expect(cls).toContain('hover:bg-brand-hover');
    // default size
    expect(cls).toContain('h-10');
    expect(cls).toContain('px-4');
  });
});

describe('btnVariants — kind × size matrix', () => {
  const expectedKindFragment: Record<BtnKind, string> = {
    primary: 'bg-brand',
    ghost: 'border-border',
    subtle: 'hover:bg-surface-hover',
    coral: 'bg-action-coral',
  };

  const expectedSizeFragment: Record<BtnSize, string> = {
    sm: 'h-8',
    default: 'h-10',
    lg: 'h-12',
  };

  for (const kind of KINDS) {
    for (const size of SIZES) {
      it(`renders kind=${kind} size=${size} with the expected fragments`, () => {
        const cls = btnVariants({ kind, size });
        expect(cls).toContain(expectedKindFragment[kind]);
        expect(cls).toContain(expectedSizeFragment[size]);
      });
    }
  }

  it('coral renders the destructive-action fill', () => {
    const cls = btnVariants({ kind: 'coral', size: 'default' });
    expect(cls).toContain('bg-action-coral');
    expect(cls).toContain('text-white');
  });

  it('ghost renders a transparent fill with a tinted border', () => {
    const cls = btnVariants({ kind: 'ghost', size: 'default' });
    expect(cls).toContain('bg-transparent');
    expect(cls).toContain('border-border');
  });

  it('subtle renders a transparent fill with no border', () => {
    const cls = btnVariants({ kind: 'subtle', size: 'default' });
    expect(cls).toContain('bg-transparent');
    expect(cls).not.toContain('border-border');
  });

  it('sm size uses text-sm; lg size uses text-base', () => {
    expect(btnVariants({ kind: 'primary', size: 'sm' })).toContain('text-sm');
    expect(btnVariants({ kind: 'primary', size: 'lg' })).toContain('text-base');
  });
});
