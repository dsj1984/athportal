// apps/web/src/components/ui/Card.test.ts
//
// Unit tests for the Card primitive's class-builder. Card.astro
// renders the markup; the builder is the testable surface.
//
// Story #713 / Task #725 — Epic #702 design-system primitive library.
import { describe, expect, it } from 'vitest';
import { buildCardView } from './Card';

describe('buildCardView', () => {
  it('renders the bordered-surface defaults (no soft shadow) when no props are passed', () => {
    const view = buildCardView();
    expect(view.soft).toBe(false);
    expect(view.rootClass).toContain('border-border');
    expect(view.rootClass).toContain('bg-surface-card');
    expect(view.rootClass).toContain('rounded-xl');
    expect(view.rootClass).not.toContain('shadow-sm');
  });

  it('layers the shadow-sm token when soft={true}', () => {
    const view = buildCardView({ soft: true });
    expect(view.soft).toBe(true);
    expect(view.rootClass).toContain('shadow-sm');
  });

  it('omits the shadow when soft={false} (explicit)', () => {
    const view = buildCardView({ soft: false });
    expect(view.rootClass).not.toContain('shadow-sm');
  });

  it('merges author-supplied extra classes through cn', () => {
    const view = buildCardView({ class: 'p-8 max-w-md' });
    expect(view.rootClass).toContain('max-w-md');
  });
});
