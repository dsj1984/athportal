// apps/web/src/components/ui/VerifiedTick.ts
//
// Pure-TS view-shape builder for the VerifiedTick primitive — an
// action-lime filled circle with a white check inside. Used by Stat
// and any surface that needs to mark a value as authoritatively
// verified (Hudl-sourced, official-source, etc.).
//
// Story #713 / Task #728 — Epic #702 design system primitive library.

export interface VerifiedTickProps {
  /** Overall rendered size in pixels. Defaults to 16. */
  readonly size?: number;
  /** Optional accessible title for the SVG. */
  readonly title?: string;
}

export interface VerifiedTickView {
  readonly size: number;
  readonly title: string;
  /** Background-circle fill — wired to the action-lime token. */
  readonly fillColor: string;
}

export const DEFAULT_VERIFIED_TICK_SIZE = 16;

export function buildVerifiedTickView(props: VerifiedTickProps = {}): VerifiedTickView {
  const size = resolvePositive(props.size, DEFAULT_VERIFIED_TICK_SIZE);
  const title = props.title?.trim() || 'Verified';
  return {
    size,
    title,
    fillColor: 'var(--color-action-lime)',
  };
}

function resolvePositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}
