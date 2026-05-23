// apps/web/src/components/ui/Ring.ts
//
// Pure-TS view-shape builder for the Ring primitive — an SVG
// circular-progress ring stroked in the brand colour. Reused by
// dashboard widgets (training-load, recovery, etc.) where a
// 0–100 percentage needs to read at a glance.
//
// Story #713 / Task #725 — Epic #702 design system primitive library.

export interface RingProps {
  /** Progress value, clamped to [0, 100]. */
  readonly value: number;
  /** Overall SVG size in pixels. Defaults to 48. */
  readonly size?: number;
  /** Stroke width in pixels. Defaults to 4. */
  readonly stroke?: number;
  /** Optional accessible label for the ring. */
  readonly label?: string;
}

export interface RingView {
  /** Clamped value (0–100). */
  readonly value: number;
  readonly size: number;
  readonly stroke: number;
  readonly radius: number;
  readonly circumference: number;
  /** SVG stroke-dasharray segment that fills the percentage. */
  readonly dashArray: string;
  /** SVG stroke-dashoffset (0 for full ring, circumference for empty). */
  readonly dashOffset: number;
  readonly label: string | null;
  /** SVG stroke colour — wired to the brand token. */
  readonly strokeColor: string;
  /** Track (unfilled portion) stroke colour. */
  readonly trackColor: string;
}

export const DEFAULT_RING_SIZE = 48;
export const DEFAULT_RING_STROKE = 4;

export function buildRingView(props: RingProps): RingView {
  const value = clamp(props.value, 0, 100);
  const size = resolvePositive(props.size, DEFAULT_RING_SIZE);
  const stroke = resolvePositive(props.stroke, DEFAULT_RING_STROKE);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = (value / 100) * circumference;
  const dashArray = `${circumference} ${circumference}`;
  const dashOffset = circumference - filled;
  const label = props.label?.trim() || null;
  return {
    value,
    size,
    stroke,
    radius,
    circumference,
    dashArray,
    dashOffset,
    label,
    // The ring is stroked with the brand token per AC ("labels with
    // the brand colour"). CSS custom property is used so a consuming
    // surface can override via `--ring-color` without forking the
    // primitive.
    strokeColor: 'var(--color-brand)',
    trackColor: 'var(--color-border)',
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function resolvePositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}
