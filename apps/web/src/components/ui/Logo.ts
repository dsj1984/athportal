// apps/web/src/components/ui/Logo.ts
//
// Pure-TS view-shape builder for the Logo primitive — an abstract
// geometric mark (chevron + dot) drawn in a brand → action-cyan
// gradient. Per docs/style-guide.md §1 (anti-cliché): no clip-art
// glyphs, no whistles, no soccer balls. The chevron implies upward
// motion / progression; the dot reads as a connectivity marker.
//
// Story #713 / Task #728 — Epic #702 design system primitive library.

export interface LogoProps {
  /** Overall rendered size in pixels. Defaults to 32. */
  readonly size?: number;
  /** Optional accessible title for the SVG. */
  readonly title?: string;
}

export interface LogoView {
  readonly size: number;
  readonly title: string;
  readonly gradientId: string;
  readonly gradientStart: string;
  readonly gradientEnd: string;
}

export const DEFAULT_LOGO_SIZE = 32;

export function buildLogoView(props: LogoProps = {}): LogoView {
  const size = resolvePositive(props.size, DEFAULT_LOGO_SIZE);
  const title = props.title?.trim() || 'Athlete Portal';
  return {
    size,
    title,
    gradientId: 'logo-gradient',
    // Brand → action-cyan gradient per AC.
    gradientStart: 'var(--color-brand)',
    gradientEnd: 'var(--color-action-cyan)',
  };
}

function resolvePositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}
