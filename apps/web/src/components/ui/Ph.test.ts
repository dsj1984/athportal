// apps/web/src/components/ui/Ph.test.ts
//
// Unit tests for the Ph (placeholder) primitive's view-shape builder.
//
// Story #713 / Task #728 — Epic #702 design-system primitive library.
import { describe, expect, it } from 'vitest';
import { buildPhView } from './Ph';

describe('buildPhView', () => {
  it('uses the sensible default label when none is provided', () => {
    const view = buildPhView();
    expect(view.label).toBe('PLACEHOLDER');
  });

  it('honours an explicit label (trimmed)', () => {
    expect(buildPhView({ label: '  Avatar slot  ' }).label).toBe('Avatar slot');
  });

  it('emits the diagonal-stripe background in the style declaration', () => {
    const view = buildPhView();
    expect(view.style).toContain('repeating-linear-gradient');
  });

  it('uses --font-mono (system mono stack) for the label font — no JetBrains Mono import', () => {
    const view = buildPhView();
    expect(view.style).toContain('var(--font-mono)');
    // Negative assertion: ensure no JetBrains Mono leaks in via the
    // inline style — the project intentionally ships no third-party
    // mono font.
    expect(view.style.toLowerCase()).not.toContain('jetbrains');
  });

  it('encodes an explicit square size (prop-variant case) into both width and height', () => {
    const view = buildPhView({ size: 96 });
    expect(view.style).toContain('width:96px');
    expect(view.style).toContain('height:96px');
  });

  it('encodes explicit width and height when provided separately', () => {
    const view = buildPhView({ width: 200, height: 100 });
    expect(view.style).toContain('width:200px');
    expect(view.style).toContain('height:100px');
  });

  it('lets `size` take precedence over width / height', () => {
    const view = buildPhView({ size: 48, width: 200, height: 80 });
    expect(view.style).toContain('width:48px');
    expect(view.style).toContain('height:48px');
    expect(view.style).not.toContain('width:200');
  });

  it('renders the placeholder root with a dashed border + hover surface', () => {
    const view = buildPhView();
    expect(view.rootClass).toContain('border-dashed');
    expect(view.rootClass).toContain('bg-surface-hover');
  });
});
