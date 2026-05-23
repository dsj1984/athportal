// apps/web/src/components/ui/Ph.ts
//
// Pure-TS view-shape builder for the Ph primitive — a striped
// placeholder rectangle with a mono label, used in styleguide
// surfaces and at design-time to mark "this slot will be filled
// later". The mono label uses the system mono stack via
// var(--font-mono); no JetBrains Mono import (per AC and per
// global.css which intentionally defines --font-mono as the system
// stack only).
//
// Story #713 / Task #728 — Epic #702 design system primitive library.

import { cn } from './_lib/cn';

export interface PhProps {
  /** Label rendered in the centre of the placeholder. */
  readonly label?: string;
  /**
   * Optional square size in pixels. Sets both width and height; takes
   * precedence over `width` / `height` when provided.
   */
  readonly size?: number;
  /** Optional explicit width in pixels (omit to fill the parent). */
  readonly width?: number;
  /** Optional explicit height in pixels (omit to fill the parent). */
  readonly height?: number;
  /** Optional extra classes, merged through `cn`. */
  readonly class?: string;
}

export interface PhView {
  readonly label: string;
  /** Class string for the placeholder root. */
  readonly rootClass: string;
  /** Inline style string carrying explicit dimensions when provided. */
  readonly style: string;
  /** Class string for the mono label (system mono stack). */
  readonly labelClass: string;
}

export function buildPhView(props: PhProps = {}): PhView {
  const label = props.label?.trim() || 'PLACEHOLDER';
  const rootClass = cn(
    'relative flex items-center justify-center rounded-md border border-dashed border-border bg-surface-hover',
    // Diagonal stripes via a repeating linear-gradient inline style
    // would couple this builder to colour — keep the visual stripe in
    // a className that wraps the inline gradient declaration.
    'ph-striped',
    props.class,
  );
  const resolvedWidth = props.size ?? props.width;
  const resolvedHeight = props.size ?? props.height;
  const style = buildDimensionStyle(resolvedWidth, resolvedHeight);
  // System-mono only: docs/style-guide.md does not ship a JetBrains
  // Mono import; --font-mono in global.css resolves to ui-monospace,
  // SFMono-Regular, Menlo, monospace.
  const labelClass = cn('text-xs font-medium uppercase tracking-wider text-text-secondary');
  return { label, rootClass, style, labelClass };
}

function buildDimensionStyle(width: number | undefined, height: number | undefined): string {
  const parts: string[] = [];
  if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
    parts.push(`width:${width}px`);
  }
  if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
    parts.push(`height:${height}px`);
  }
  // Diagonal-stripe background painted inline so the primitive does
  // not need any external CSS shipped alongside it.
  parts.push(
    'background-image:repeating-linear-gradient(135deg, transparent 0 8px, rgba(15,17,21,0.04) 8px 10px)',
  );
  parts.push('font-family:var(--font-mono)');
  return parts.length === 0 ? '' : `${parts.join(';')};`;
}
