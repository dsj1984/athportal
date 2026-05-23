// apps/web/src/components/ui/Avatar.ts
//
// Pure-TS view-shape builder for the Avatar primitive. Renders an
// uploaded photo when `src` is provided, otherwise renders the user's
// uppercase initials over an OKLCH gradient fallback keyed off the
// `hue` prop (Story #713 / Task #721 — Epic #702 design-system, per
// docs/style-guide.md §3.1 brand-gradient pattern).
//
// Pre-existing call sites (dashboard avatar surface, onboarding photo
// preview pane) continue to work unchanged — the new `hue` and `size`
// props default to the same visual the prior implementation produced
// for the initials branch. PRD #703 / Tech Spec #704.

/** Canonical data-testid exposed by the dashboard's avatar surface. */
export const DASHBOARD_AVATAR_TEST_ID = 'dashboard-avatar';

/** Default hue (degrees in OKLCH colour space) — brand-violet. */
export const DEFAULT_AVATAR_HUE = 270;

/** Default rendered size (pixels) when no `size` prop is provided. */
export const DEFAULT_AVATAR_SIZE = 40;

/** Public props for the Avatar primitive. */
export interface AvatarProps {
  /** The user's display name. Used to derive the initials fallback. */
  readonly name: string;
  /** Optional URL of the user's uploaded profile photo. */
  readonly src?: string | null;
  /** Optional data-testid override (defaults to the canonical id). */
  readonly testId?: string;
  /**
   * Optional OKLCH hue (in degrees, 0–360) used for the gradient
   * fallback when no photo is provided. Defaults to 270 (brand-violet)
   * so unbranded surfaces inherit the platform's primary identity.
   */
  readonly hue?: number;
  /**
   * Optional pixel size for the rendered avatar. Drives both width and
   * height so the avatar is always square. Defaults to 40px.
   */
  readonly size?: number;
}

/** Render-time view shape consumed by the `.astro` sibling. */
export interface AvatarView {
  /** When non-null, the `.astro` renders an `<img>` with this src. */
  readonly src: string | null;
  /** Always populated — used as the `<img>`'s alt text AND the initials-branch text content. */
  readonly name: string;
  /** Uppercase initials for the no-photo branch. Never empty when name is valid. */
  readonly initials: string;
  /** data-testid for the rendered root. */
  readonly testId: string;
  /** Resolved hue in degrees — always inside [0, 360). */
  readonly hue: number;
  /** Resolved pixel size — always a positive integer. */
  readonly size: number;
  /**
   * Inline CSS string for the initials-branch root. Encodes the OKLCH
   * gradient + the resolved width / height so the `.astro` renderer
   * does not need to know about the colour-space details.
   */
  readonly fallbackStyle: string;
  /** Inline CSS string for the photo-branch root (width / height only). */
  readonly imageStyle: string;
}

/**
 * Project an Avatar's props into the render-ready view. Always
 * computes the initials so the `.astro` sibling can fall back to them
 * if the `<img>` fails to load. Throws `TypeError` when `name` is
 * empty or whitespace-only — every authenticated surface has a
 * display name by construction, so an empty name is an authoring bug.
 */
export function buildAvatarView(props: AvatarProps): AvatarView {
  const name = props.name.trim();
  if (name.length === 0) {
    throw new TypeError('Avatar: `name` must be a non-empty string.');
  }
  const initials = computeInitials(name);
  const trimmedSrc = props.src?.trim();
  const src = typeof trimmedSrc === 'string' && trimmedSrc.length > 0 ? trimmedSrc : null;
  const testId = props.testId?.trim() || DASHBOARD_AVATAR_TEST_ID;
  const hue = resolveHue(props.hue);
  const size = resolveSize(props.size);
  const fallbackStyle = buildFallbackStyle(hue, size);
  const imageStyle = buildImageStyle(size);
  return { src, name, initials, testId, hue, size, fallbackStyle, imageStyle };
}

/**
 * Derive uppercase initials from a display name. Takes the first
 * grapheme of the first and last whitespace-separated tokens. Single-
 * token names yield a single character; tokens with non-Latin
 * leading characters (e.g. emoji) yield the codepoint itself.
 */
export function computeInitials(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return '';
  const firstToken = tokens[0] ?? '';
  const lastToken = tokens[tokens.length - 1] ?? '';
  if (tokens.length === 1) return firstChar(firstToken).toUpperCase();
  return (firstChar(firstToken) + firstChar(lastToken)).toUpperCase();
}

function firstChar(token: string): string {
  return Array.from(token)[0] ?? '';
}

function resolveHue(hue: number | undefined): number {
  if (typeof hue !== 'number' || !Number.isFinite(hue)) return DEFAULT_AVATAR_HUE;
  // Normalise into [0, 360) so consumers can pass any integer or
  // negative offset without the renderer producing invalid CSS.
  const mod = ((hue % 360) + 360) % 360;
  return mod;
}

function resolveSize(size: number | undefined): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return DEFAULT_AVATAR_SIZE;
  }
  return Math.round(size);
}

function buildFallbackStyle(hue: number, size: number): string {
  // Brand gradient per docs/style-guide.md §3.1: a saturated OKLCH
  // gradient keyed off the resolved hue so each name renders a
  // distinct but on-brand surface.
  const start = `oklch(0.72 0.18 ${hue})`;
  const end = `oklch(0.55 0.20 ${(hue + 35) % 360})`;
  return `width:${size}px;height:${size}px;background:linear-gradient(135deg, ${start}, ${end});`;
}

function buildImageStyle(size: number): string {
  return `width:${size}px;height:${size}px;`;
}
